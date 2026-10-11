#!/usr/bin/env python3
"""Exercise store.py without Home Assistant installed.

The store is where the data can actually be corrupted — a part number lost on
import, stock that drifts after an undo, a log entry out of order. Those are
worth proving before the code ever reaches a real install, and none of them need
Home Assistant: a handful of stubs stand in for Store and the core types so the
logic can be driven directly.

    python3 tools/verify-store.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "custom_components", "elmer")

# ---------------------------------------------------------------- stub HA ----

saved: list[dict] = []


class FakeStore:
    def __init__(self, hass, version, key):
        self._data = None

    async def async_load(self):
        return self._data

    async def async_save(self, data):
        # Round-trip through JSON so anything unserialisable fails here rather
        # than silently at runtime in a real install.
        self._data = json.loads(json.dumps(data))
        saved.append(self._data)


def install_stubs():
    ha = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = object
    core.callback = lambda fn: fn
    helpers = types.ModuleType("homeassistant.helpers")
    storage = types.ModuleType("homeassistant.helpers.storage")
    storage.Store = FakeStore
    for name, mod in [
        ("homeassistant", ha),
        ("homeassistant.core", core),
        ("homeassistant.helpers", helpers),
        ("homeassistant.helpers.storage", storage),
    ]:
        sys.modules[name] = mod

    # Load the package's two modules as a real package so `from . import
    # schedule` resolves the same way it will inside Home Assistant.
    pkg = types.ModuleType("elmer")
    pkg.__path__ = [os.path.abspath(PKG)]
    sys.modules["elmer"] = pkg
    import importlib

    return importlib.import_module("elmer.store"), importlib.import_module("elmer.schedule")


store_mod, schedule = install_stubs()

# ------------------------------------------------------------------ checks ----

FAILS: list[str] = []
CHECKS = [0]


def check(label, got, want):
    CHECKS[0] += 1
    if got != want:
        FAILS.append(f"{label}\n    got  {got!r}\n    want {want!r}")


def new_store():
    s = store_mod.ElmerStore(object())
    return s


async def main() -> int:
    # --- normalize migrates the shapes older files have -------------------
    legacy = {
        "equipment": [
            {
                "id": "e1",
                "name": "Furnace",
                "location": "Basement",
                "links": [{"label": "Manual", "url": "example.com"}],
                "contact": "dave@hvac.example",
            },
            {"id": "e2", "name": "Fridge", "contact": "(555) 123-4567"},
            {
                "id": "e3",
                "name": "Pool Pump",
                "purchasedOn": "2024-05-02",
                "orderNumber": "WO-4471-B",
            },
        ],
        "tasks": [
            {
                "id": "t1",
                "equipmentId": "e1",
                "name": "Replace air filter",
                "lastDone": "2026-01-31",
                "intervalCount": 1,
                "intervalUnit": "months",
                "partNumber": "20x25x1",
            },
            {
                "id": "t2",
                "equipmentId": "e2",
                "name": "Replace water filter",
                "lastDone": "2026-09-01",
                "intervalCount": 6,
                "intervalUnit": "months",
                "partsUsed": [{"supplyId": "s1", "quantity": 0}],
            },
        ],
        "supplies": [{"id": "s1", "name": "WF-100", "quantity": "2", "reorderAt": "1"}],
        "log": [],
    }
    n = store_mod.normalize(legacy)

    check("links -> parts", n["equipment"][0]["parts"], [{"label": "Manual", "url": "example.com"}])
    check("contact -> email", n["equipment"][0]["email"], "dave@hvac.example")
    check("email leaves phone empty", n["equipment"][0]["phone"], "")
    check("contact -> phone", n["equipment"][1]["phone"], "(555) 123-4567")
    check("phone leaves email empty", n["equipment"][1]["email"], "")
    check("partNumber lifted to equipment", n["equipment"][0]["partNumber"], "20x25x1")
    check("partNumber dropped from routine", "partNumber" in n["tasks"][0], False)
    check("quantity 0 floors at 1", n["tasks"][1]["partsUsed"][0]["quantity"], 1)
    check("numeric strings coerced", n["supplies"][0]["quantity"], 2)
    check("reorderAt coerced", n["supplies"][0]["reorderAt"], 1)
    # Equipment is copied wholesale rather than rebuilt from a field list, so
    # a field the panel adds reaches the file without the store knowing it
    # exists. That is only true for as long as nobody turns this into a
    # whitelist, which is what this pins down.
    # The one text size became two. Whatever an older file chose was chosen on
    # some screen and meant for every screen, so it has to apply to both —
    # otherwise upgrading silently shrinks the phone back to Default.
    one_size = store_mod.normalize({"settings": {"textSize": "larger"}})["settings"]
    check("an older file's text size reaches the wide screen", one_size["textSize"], "larger")
    check("and the narrow one too", one_size["textSizeNarrow"], "larger")
    both = store_mod.normalize(
        {"settings": {"textSize": "larger", "textSizeNarrow": "small"}}
    )["settings"]
    check("a file that already has both keeps them apart", both["textSizeNarrow"], "small")
    check("without disturbing the other", both["textSize"], "larger")
    fresh = store_mod.normalize({})["settings"]
    check("and a file with neither starts at the default", fresh["textSizeNarrow"], "default")

    check("a purchase date survives a round trip", n["equipment"][2]["purchasedOn"], "2024-05-02")
    check("so does an order number", n["equipment"][2]["orderNumber"], "WO-4471-B")
    check("settings defaulted", n["settings"]["dueSoonDays"], 14)
    check("garbage in -> empty out", store_mod.normalize("nope")["tasks"], [])
    check("None in -> empty out", store_mod.normalize(None)["equipment"], [])

    # --- put patches rather than replaces --------------------------------
    s = new_store()
    await s.async_load()
    await s.async_replace(legacy, merge=False)
    await s.async_apply([("routine.put", {"id": "t1", "lastDone": "2026-02-02"})])
    t1 = s.task("t1")
    check("put patches lastDone", t1["lastDone"], "2026-02-02")
    check("put keeps the name", t1["name"], "Replace air filter")
    check("put keeps the interval", t1["intervalCount"], 1)

    # --- completion draws down stock and records what it took -------------
    s = new_store()
    await s.async_load()
    await s.async_replace(
        {
            "equipment": [{"id": "e1", "name": "Furnace"}],
            "tasks": [
                {
                    "id": "t1",
                    "equipmentId": "e1",
                    "name": "Replace air filter",
                    "lastDone": "2026-06-01",
                    "intervalCount": 3,
                    "intervalUnit": "months",
                    "partsUsed": [{"supplyId": "s1", "quantity": 9}],
                }
            ],
            "supplies": [{"id": "s1", "name": "Filter", "quantity": 5, "reorderAt": 2}],
        },
        merge=False,
    )

    entry = await s.async_complete("t1", done_on="2026-10-01")
    check("stock floors at zero", s.supply("s1")["quantity"], 0)
    check("records what was taken, not what was wanted", entry["usedParts"], [{"supplyId": "s1", "quantity": 5}])
    check("lastDone moved", s.task("t1")["lastDone"], "2026-10-01")
    check("previous date remembered", entry["previousLastDone"], "2026-06-01")
    check("history has one entry", len(s.data["log"]), 1)

    await s.async_undo(entry["id"])
    check("undo restores exactly what was taken", s.supply("s1")["quantity"], 5)
    check("undo restores the date", s.task("t1")["lastDone"], "2026-06-01")
    check("undo removes the entry", s.data["log"], [])

    # The bug this guards: capping the draw at 5 but recording 9 would hand back
    # 9 on undo, inventing 4 units of stock.

    # --- a routine that needs nothing still completes ---------------------
    await s.async_apply([("routine.put", {"id": "t2", "equipmentId": "e1", "name": "Inspect", "lastDone": "2026-01-01", "intervalCount": 1, "intervalUnit": "years"})])
    e2 = await s.async_complete("t2", done_on="2026-10-02")
    check("no parts, no drawdown", e2["usedParts"], [])
    check("unknown routine returns None", await s.async_complete("nope"), None)
    check("unknown log returns None", await s.async_undo("nope"), None)

    # --- history stays newest-first --------------------------------------
    s = new_store()
    await s.async_load()
    await s.async_replace(
        {
            "tasks": [
                {"id": f"t{i}", "name": f"R{i}", "lastDone": "2026-01-01", "intervalCount": 1, "intervalUnit": "months"}
                for i in range(4)
            ]
        },
        merge=False,
    )
    for i in range(4):
        await s.async_complete(f"t{i}", done_on="2026-10-01")  # same day on purpose
    check(
        "newest completion first, even on one day",
        [l["taskName"] for l in s.data["log"]],
        ["R3", "R2", "R1", "R0"],
    )

    # --- merge import is idempotent --------------------------------------
    export = s.export()
    before = json.dumps(s.data, sort_keys=True)
    await s.async_replace(export, merge=True)
    check("re-importing an export changes nothing", json.dumps(s.data, sort_keys=True), before)
    counts = await s.async_replace(export, merge=True)
    check("import reports what it saw", counts["routines"], 4)
    check("log not duplicated by merge", len(s.data["log"]), 4)

    # --- export round-trips through normalize ----------------------------
    fresh = new_store()
    await fresh.async_load()
    await fresh.async_replace(s.export(), merge=False)
    check(
        "export -> import is lossless",
        json.dumps(fresh.data, sort_keys=True),
        json.dumps(s.data, sort_keys=True),
    )

    # --- part.adjust is a delta, and floors at zero -----------------------
    s = new_store()
    await s.async_load()
    await s.async_replace({"supplies": [{"id": "s1", "name": "Filter", "quantity": 3}]}, merge=False)
    await s.async_apply([("part.adjust", {"id": "s1", "delta": -10})])
    check("adjust floors at zero", s.supply("s1")["quantity"], 0)
    await s.async_apply([("part.adjust", {"id": "s1", "delta": 4})])
    check("adjust adds", s.supply("s1")["quantity"], 4)
    check("adjust stamps updatedAt", isinstance(s.supply("s1").get("updatedAt"), int), True)

    # --- deleting equipment takes its routines with it --------------------
    s = new_store()
    await s.async_load()
    await s.async_replace(legacy, merge=False)
    await s.async_apply([("equipment.delete", {"id": "e1"})])
    check("equipment gone", s.equipment("e1"), None)
    check("its routines gone too", s.task("t1"), None)
    check("other equipment untouched", s.equipment("e2")["name"], "Fridge")

    # --- unknown ops are ignored, not fatal ------------------------------
    before = json.dumps(s.data, sort_keys=True)
    s.apply_op("something.new", {"id": "x"})
    check("unknown op is a no-op", json.dumps(s.data, sort_keys=True), before)

    # --- name lookup ------------------------------------------------------
    s = new_store()
    await s.async_load()
    await s.async_replace(
        {
            "equipment": [{"id": "e1", "name": "Furnace"}, {"id": "e2", "name": "Fridge"}],
            "tasks": [
                {"id": "t1", "equipmentId": "e1", "name": "Replace filter"},
                {"id": "t2", "equipmentId": "e2", "name": "Replace filter"},
                {"id": "t3", "equipmentId": "e1", "name": "Professional service"},
            ],
        },
        merge=False,
    )
    check("unique name resolves", s.find_task_by_name("Professional service")["id"], "t3")
    check("case insensitive", s.find_task_by_name("professional SERVICE")["id"], "t3")
    check("id resolves", s.find_task_by_name("t1")["id"], "t1")
    check("qualified name resolves", s.find_task_by_name("Fridge: Replace filter")["id"], "t2")
    check("missing name is None", s.find_task_by_name("nope"), None)
    try:
        s.find_task_by_name("Replace filter")
        check("ambiguous name refused", "no error", "ValueError")
    except ValueError as err:
        check("ambiguous name refused", "2 routines" in str(err), True)

    # --- counts -----------------------------------------------------------
    s = new_store()
    await s.async_load()
    today = schedule.today()
    await s.async_replace(
        {
            "tasks": [
                {"id": "a", "name": "overdue", "lastDone": schedule.add_interval(today, -60, "days"), "intervalCount": 1, "intervalUnit": "months"},
                {"id": "b", "name": "due", "lastDone": schedule.add_interval(today, -25, "days"), "intervalCount": 1, "intervalUnit": "months"},
                {"id": "c", "name": "ok", "lastDone": today, "intervalCount": 1, "intervalUnit": "years"},
                {"id": "d", "name": "new", "lastDone": None, "intervalCount": 1, "intervalUnit": "months"},
            ],
            "supplies": [
                {"id": "s1", "name": "none left", "quantity": 0, "reorderAt": 1},
                {"id": "s2", "name": "at the floor", "quantity": 2, "reorderAt": 2},
                {"id": "s3", "name": "plenty", "quantity": 9, "reorderAt": 2},
            ],
        },
        merge=False,
    )
    check("counts", s.counts(), {"overdue": 1, "due": 1, "new": 1, "ok": 1, "lowStock": 2,
                                 "partsShort": 0, "equipment": 0})
    # Never-done ranks ahead of fine: STATUS_RANK puts 'new' at 2 and 'ok' at 3,
    # because a routine with no date needs attention more than one that is fine.
    check("urgency order", [r["task"]["id"] for r in s.rows()], ["a", "b", "d", "c"])
    check("out of stock", schedule.stock_status({"quantity": 0, "reorderAt": 0}), "out")
    check("at the reorder point is low", schedule.stock_status({"quantity": 2, "reorderAt": 2}), "low")
    check("above it is fine", schedule.stock_status({"quantity": 3, "reorderAt": 2}), "ok")

    # --- parts the coming routines will be short of -----------------------
    # A different question from the reorder point: not "is this part below its
    # own threshold" but "can the schedule actually be carried out". The two
    # disagree in both directions, which is the whole reason for it.
    s = new_store()
    await s.async_load()
    today = schedule.today()
    await s.async_replace(
        {
            "tasks": [
                # Both due soon and both wanting the same filter: 2 + 1 = 3.
                {"id": "a", "name": "furnace filter", "lastDone": schedule.add_interval(today, -60, "days"),
                 "intervalCount": 1, "intervalUnit": "months",
                 "partsUsed": [{"supplyId": "filter", "quantity": 2}]},
                {"id": "b", "name": "second filter", "lastDone": schedule.add_interval(today, -25, "days"),
                 "intervalCount": 1, "intervalUnit": "months",
                 "partsUsed": [{"supplyId": "filter", "quantity": 1}]},
                # Not due for a year: its parts are not needed yet.
                {"id": "c", "name": "far off", "lastDone": today,
                 "intervalCount": 1, "intervalUnit": "years",
                 "partsUsed": [{"supplyId": "belt", "quantity": 5}]},
                # Never done, so nothing is scheduled and nothing is needed.
                {"id": "d", "name": "never done", "lastDone": None,
                 "intervalCount": 1, "intervalUnit": "months",
                 "partsUsed": [{"supplyId": "gasket", "quantity": 4}]},
            ],
            "supplies": [
                # Two on the shelf and well above its reorder point, yet three
                # are needed: a threshold alone would call this fine.
                {"id": "filter", "name": "Filter", "quantity": 2, "reorderAt": 0},
                {"id": "belt", "name": "Belt", "quantity": 1, "reorderAt": 0},
                {"id": "gasket", "name": "Gasket", "quantity": 0, "reorderAt": 0},
            ],
        },
        merge=False,
    )
    short = s.parts_short()
    check("only the part the schedule actually needs is short",
          [r["name"] for r in short], ["Filter"])
    check("two routines sharing a part are added together", short[0]["needed"], 3)
    check("against what is on the shelf", short[0]["on_hand"], 2)
    check("leaving the shortfall", short[0]["short"], 1)
    check("and it names the routines that want it",
          short[0]["routines"], ["furnace filter", "second filter"])
    check("the count follows", s.counts()["partsShort"], 1)
    # And the gap itself: the part that is short reads perfectly healthy by the
    # reorder point, because two on the shelf is above a threshold of zero.
    # Nothing but this check would have noticed.
    check("while the short part's own reorder point calls it fine",
          schedule.stock_status(s.supply("filter")), "ok")

    # Enough on the shelf and the shortfall goes away.
    await s.async_apply([("part.adjust", {"id": "filter", "delta": 1})])
    check("topping it up clears it", s.parts_short(), [])

    # A part deleted out from under a routine must not raise.
    await s.async_apply([("part.delete", {"id": "filter"})])
    check("a routine pointing at a deleted part is skipped", s.parts_short(), [])

    # --- listeners fire once per batch ------------------------------------
    hits = [0]
    remove = s.add_listener(lambda: hits.__setitem__(0, hits[0] + 1))
    await s.async_apply([("part.adjust", {"id": "s1", "delta": 1}), ("part.adjust", {"id": "s3", "delta": 1})])
    check("one notification per batch", hits[0], 1)
    remove()
    await s.async_apply([("part.adjust", {"id": "s1", "delta": 1})])
    check("removed listener stays quiet", hits[0], 1)

    # --- everything we store survives JSON --------------------------------
    check("every save round-tripped through JSON", len(saved) > 0, True)

    if FAILS:
        print(f"FAIL — {len(FAILS)} of {CHECKS[0]} checks\n")
        for f in FAILS:
            print("  " + f)
        return 1
    print(f"PASS — {CHECKS[0]} checks")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
