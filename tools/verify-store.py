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
import re
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

    # --- cards per row -----------------------------------------------------
    # Two counts, split at the same breakpoint the text sizes use. Clamped
    # rather than refused: a file asking for more columns than exist wanted as
    # many as it could get.
    check("the card counts start at three and two",
          (fresh["cardsWide"], fresh["cardsNarrow"]), (3, 2))
    for given, want in ((2, 2), (3, 3), (4, 4), (5, 4), (9, 4), (1, 2), (0, 2),
                        ("x", 3), (None, 3)):
        got = store_mod.normalize({"settings": {"cardsWide": given}})["settings"]["cardsWide"]
        check(f"a desktop count of {given!r} lands on {want}", got, want)
    for given, want in ((1, 1), (2, 2), (3, 3), (4, 3), (0, 1), ("x", 2)):
        got = store_mod.normalize({"settings": {"cardsNarrow": given}})["settings"]["cardsNarrow"]
        check(f"a mobile count of {given!r} lands on {want}", got, want)
    # The two clamps and the two menus have to agree, or a count a menu offers
    # is silently pulled back to something else the moment it is saved. They
    # have moved together twice now — four on a desktop was offered, taken
    # away, and offered again — so the menus are read rather than restated.
    views = open(
        os.path.join(PKG, "frontend", "views.js"), encoding="utf-8"
    ).read()
    for act, want in (("set-cards", [2, 3, 4]), ("set-cards-narrow", [1, 2, 3])):
        block = views.split(f"act: '{act}',", 1)[1].split("}))", 1)[0]
        offered = [int(n) for n in re.findall(r"\[(\d+), '\d+'\]", block)]
        check(f"the {act} menu offers {want}", offered, want)
        key = "cardsWide" if act == "set-cards" else "cardsNarrow"
        kept = [
            store_mod.normalize({"settings": {key: n}})["settings"][key]
            for n in offered
        ]
        check(f"and the store keeps every one of them", kept, offered)
    # Whole numbers only: a fractional column is not a thing a grid can draw.
    check("and they survive a round trip as integers",
          [type(fresh["cardsWide"]).__name__, type(fresh["cardsNarrow"]).__name__],
          ["int", "int"])

    # --- the ring agrees with the number inside it -------------------------
    # The ring is how near the day is, measured against the warn-ahead
    # window. It used to be the proportion of the service interval elapsed,
    # which is a different quantity wearing the same clothes: fourteen days
    # is a bigger slice of a month than of six months, so a six-monthly
    # routine a fortnight out drew a fuller ring than a monthly one five days
    # out. The ring sits inside a list ordered by days left and has a count
    # of days printed in the middle of it, so of the two quantities it is
    # this one that has to be true.
    fixed = "2026-10-31"
    real_today = schedule.today
    schedule.today = lambda: fixed
    try:
        def ring(days_ahead, soon=14, **task):
            due = schedule.add_interval(fixed, days_ahead, "days")
            # Built backwards from the date wanted, so the interval is only
            # ever the thing being varied.
            base = {"lastDone": schedule.add_interval(due, -90, "days"),
                    "intervalCount": 90, "intervalUnit": "days"}
            return schedule.task_state(dict(base, **task), soon)

        # The case that was reported, both intervals, same days left.
        monthly = schedule.task_state(
            {"lastDone": "2026-10-05", "intervalCount": 1, "intervalUnit": "months"}, 14)
        six = schedule.task_state(
            {"lastDone": "2026-05-14", "intervalCount": 6, "intervalUnit": "months"}, 14)
        check("the reported pair are 5 and 14 days out",
              [monthly["daysLeft"], six["daysLeft"]], [5, 14])
        check("and the nearer one now draws the fuller ring",
              monthly["progress"] > six["progress"], True)

        # The general property, which is the whole point: across a spread of
        # intervals and distances, a ring never contradicts the number.
        spread = []
        for days in (-30, -1, 0, 1, 5, 9, 14, 15, 40, 400):
            for every, unit in ((1, "months"), (6, "months"), (2, "weeks"), (3, "years")):
                st = ring(days, intervalCount=every, intervalUnit=unit)
                spread.append((st["daysLeft"], st["progress"]))
        bad = [
            (a, b) for a in spread for b in spread
            if a[0] < b[0] and a[1] < b[1]
        ]
        check("nearer always means fuller, whatever the interval", bad, [])

        # The ends and the edges of the window.
        check("full on the day", ring(0)["progress"], 1.0)
        check("and full while overdue", ring(-30)["progress"], 1.0)
        check("empty as it enters the window", ring(14)["progress"], 0.0)
        check("and empty beyond it", ring(400)["progress"], 0.0)
        check("halfway through the run-up, halfway round",
              round(ring(7)["progress"], 3), 0.5)

        # And it wants no history, so a routine nobody has done reads like
        # one that has been done for years. This is what drew an empty ring
        # on something due tomorrow.
        never = schedule.task_state({"schedule": "clocks", "clocks": ["fall"]}, 14)
        check("a never-done routine due tomorrow is nearly full",
              [never["daysLeft"], round(never["progress"], 3)], [1, round(13 / 14, 3)])
        check("though it still reports no cycle, having never been done",
              never["cycle"], None)
        # The warn-ahead setting is the scale the ring is drawn against, so
        # widening it starts the ring earlier. At forty days out a fortnight
        # of warning has not begun and two months of it is a third gone.
        check("forty days out is nothing to a fortnight of warning",
              ring(40)["progress"], 0.0)
        check("and a third of the way round with two months of it",
              round(ring(40, soon=60)["progress"], 2), 0.33)
    finally:
        schedule.today = real_today

    # --- the four schedule kinds -------------------------------------------
    # Which kind is live is stored now rather than inferred, because at four
    # kinds a routine can hold the makings of all of them and inference would
    # lose whichever lost the precedence. The point of storing it is that
    # switching away and back finds the old answer still there, so these
    # check that nothing is cleared.
    def one(task):
        return store_mod.normalize({"tasks": [dict({"id": "t", "name": "x"}, **task)]})["tasks"][0]

    check("an unknown kind falls back the way a file written before this read",
          one({"schedule": "nonsense", "months": [3]})["schedule"], "months")
    check("and with no months, to an interval",
          one({"schedule": None})["schedule"], "interval")
    for kind in ("interval", "months", "clocks", "date"):
        check(f"{kind} is kept as given", one({"schedule": kind})["schedule"], kind)

    both = one({
        "schedule": "clocks", "clocks": ["fall", "spring"],
        "months": [6], "intervalCount": 9, "intervalUnit": "weeks",
        "onDate": "2026-12-25",
    })
    check("clocks come back in the order they fall, not the order ticked",
          both["clocks"], ["spring", "fall"])
    check("and the other three kinds' settings are all still there",
          [both["months"], both["intervalCount"], both["intervalUnit"], both["onDate"]],
          [[6], 9, "weeks", "2026-12-25"])
    for given, want in (
        (["spring"], ["spring"]), (["fall"], ["fall"]),
        (["spring", "spring"], ["spring"]), (["winter"], []),
        ("spring", []), (None, []), ([], []),
    ):
        check(f"clocks {given!r} normalise to {want}", one({"clocks": given})["clocks"], want)

    check("a date that is not one is no date at all",
          [one({"onDate": v})["onDate"] for v in ("2026-13-40", "soon", "", None)],
          [None, None, None, None])
    check("and one that is survives", one({"onDate": "2026-12-25"})["onDate"], "2026-12-25")
    # Yearly for anything absent: the other reading would retire a routine
    # the first time it was done, which is not a thing to guess at.
    check("a missing yearly flag means yearly", one({})["onDateYearly"], True)
    check("and an explicit no means once", one({"onDateYearly": False})["onDateYearly"], False)

    # --- sorting -----------------------------------------------------------
    # The store's job here is only to refuse a field that does not exist; the
    # ordering itself is the panel's and is tested there. The allowed sets are
    # read back out of the panel's own SORT_FIELDS rather than retyped, so
    # adding a field on one side and not the other fails here.
    check("equipment starts sorted by name", fresh["sortEquipment"], "name")
    check("both start ascending",
          (fresh["sortEquipmentDir"], fresh["sortPartsDir"]), ("asc", "asc"))
    # Parts have one order, so there is no field setting to go with their
    # direction. A key with one legal value is not a setting.
    check("parts have a direction and no field",
          ("sortPartsDir" in fresh, "sortParts" in fresh), (True, False))

    util_js = open(os.path.join(PKG, "frontend", "util.js"), encoding="utf-8").read()
    block = util_js.split("export const SORT_FIELDS")[1].split("\n};")[0]
    # Each list's array runs to the line that closes it. Counted as well as
    # compared, because an extraction that quietly matches one entry would let
    # the rest of this pass without testing anything.
    for tab, expected in (("equipment", 2), ("parts", 1)):
        arr = block.split(f"{tab}: [")[1].split("\n  ],")[0]
        # Anchored to the line start, so the columns nested inside an entry
        # are not counted as entries of their own.
        fields = re.findall(r"^\s*\['([a-zA-Z]+)',", arr, re.MULTILINE)
        check(f"{tab} offers {expected} order(s)", len(fields), expected)
        if tab != "equipment":
            continue
        for field in fields:
            got = store_mod.normalize({"settings": {"sortEquipment": field}})["settings"]["sortEquipment"]
            check(f"the store accepts equipment sorted by {field}", got, field)
        check("and refuses an equipment order that is neither",
              store_mod.normalize({"settings": {"sortEquipment": "nonesuch"}})["settings"]["sortEquipment"],
              store_mod.DEFAULT_SETTINGS["sortEquipment"])

    check("a direction that is neither falls back to ascending",
          store_mod.normalize({"settings": {"sortPartsDir": "sideways"}})["settings"]["sortPartsDir"],
          "asc")
    check("and a real one survives",
          store_mod.normalize({"settings": {"sortPartsDir": "desc"}})["settings"]["sortPartsDir"],
          "desc")

    # --- the overdue notice ----------------------------------------------
    # The Home Assistant half of the badge is three lines of create and
    # dismiss; what is worth checking is what it says, which is why the
    # wording lives in a pure function.
    check("the badge is off unless asked for", fresh["badgeOverdue"], False)
    check("and is always a boolean",
          store_mod.normalize({"settings": {"badgeOverdue": "yes"}})["settings"]["badgeOverdue"], True)

    # --- content width -----------------------------------------------------
    check("the content width starts at the default", fresh["contentWidth"], "default")
    for given, want in (
        ("wide", "wide"), ("widest", "widest"), ("default", "default"),
        ("enormous", "default"), ("", "default"), (1040, "default"), (None, "default"),
    ):
        got = store_mod.normalize({"settings": {"contentWidth": given}})["settings"]["contentWidth"]
        check(f"a width of {given!r} lands on {want!r}", got, want)
    # Named rather than stored as a number of pixels, so the steps can be
    # retuned later without rewriting what people already have saved.
    check("and it is a name, not a measurement",
          isinstance(fresh["contentWidth"], str), True)

    # --- snoozing ----------------------------------------------------------
    # The arithmetic is held against the reference implementation by
    # verify-schedule.py, including the day the snooze ends. What is only on
    # this side is what the store will accept, and that doing the job ends it.
    for given, want in (
        ("2026-12-01", "2026-12-01"),
        ("not-a-date", None),
        ("2026-13-45", None),
        ("", None),
        (None, None),
        (12345, None),
    ):
        got = store_mod.normalize({"tasks": [{"id": "t", "snoozedUntil": given}]})["tasks"][0]
        check(f"snoozedUntil {given!r} normalises to {want!r}", got["snoozedUntil"], want)

    soon = schedule.add_interval(schedule.today(), 10, "days")
    asleep = {"id": "t", "lastDone": schedule.add_interval(schedule.today(), -90, "days"),
              "intervalCount": 1, "intervalUnit": "months", "snoozedUntil": soon}
    st = schedule.task_state(asleep)
    check("an asleep routine reads as asleep", st["status"], "snoozed")
    check("and reports no days left, so no automation fires on it",
          st["daysLeft"], None)
    check("while still saying when it was really due",
          st["due"], schedule.add_interval(asleep["lastDone"], 1, "months"))
    check("and when it wakes", st["snoozedUntil"], soon)
    # A snooze that ends today has ended: the comparison is strict, so there
    # is no day where it is both over and still hiding the routine.
    check("a snooze ending today is over",
          schedule.task_state(dict(asleep, snoozedUntil=schedule.today()))["status"],
          "overdue")
    check("one ending tomorrow is not",
          schedule.task_state(dict(asleep, snoozedUntil=schedule.add_interval(schedule.today(), 1, "days")))["status"],
          "snoozed")
    # Paused beats asleep: pausing is the deliberate one, and a routine
    # carrying both should read as the stronger of the two.
    check("paused wins over asleep",
          schedule.task_state(dict(asleep, paused=True))["status"], "paused")

    # --- seasonal routines -------------------------------------------------
    # The arithmetic itself is held against the reference implementation by
    # verify-schedule.py across hundreds of routines. What is checked here is
    # the part that is only on this side: what the store will accept as a
    # month, and that months win over an interval that is still stored.
    for given, want in (
        ([10], [10]),
        ([10, 4], [4, 10]),
        ([3, 3, 3], [3]),
        (["4", 10.0], [4, 10]),
        ([0, 13, -1], []),
        ([1, 99, 6], [1, 6]),
        ("october", []),
        (None, []),
        ([], []),
    ):
        got = store_mod.normalize({"tasks": [{"id": "t", "months": given}]})["tasks"][0]["months"]
        check(f"months {given!r} normalise to {want}", got, want)

    seasonal = {"id": "t", "lastDone": "2026-09-20", "months": [10],
                "intervalCount": 3, "intervalUnit": "months"}
    check("a month anchor beats the interval beside it",
          schedule.next_due(seasonal), "2026-10-01")
    check("and the interval is used again once the months go",
          schedule.next_due(dict(seasonal, months=[])), "2026-12-20")
    # The point of the whole feature: doing it late must not move next year.
    check("doing it late in the month does not drag next year later",
          schedule.next_due(dict(seasonal, lastDone="2026-10-29")), "2027-10-01")
    check("and doing it early does not either",
          schedule.next_due(dict(seasonal, lastDone="2026-10-01")), "2027-10-01")
    check("twice a year alternates",
          schedule.next_due(dict(seasonal, months=[4, 10], lastDone="2026-04-15")),
          "2026-10-01")
    check("and wraps into next year from the last one",
          schedule.next_due(dict(seasonal, months=[4, 10], lastDone="2026-10-15")),
          "2027-04-01")
    check("a December anchor rolls over",
          schedule.next_due(dict(seasonal, months=[12], lastDone="2026-12-05")),
          "2027-12-01")
    # Never done used to mean no date at all. A month-anchored routine knows
    # its own dates, so now it has one: the next October, counted from today
    # rather than from a last-done it does not have.
    never = schedule.next_due(dict(seasonal, lastDone=None))
    check("never done still lands on the chosen month",
          (never or "")[5:], "10-01")
    check("and it is in the future", bool(never) and never > schedule.today(), True)
    # Nothing to go on is still nothing to go on, and that is a different
    # thing from never having done it.
    check("a month-anchored routine with no months ticked has no date",
          schedule.next_due(dict(seasonal, schedule="months", months=[], lastDone=None)),
          None)
    # Pausing has to keep working on a seasonal routine, since the two
    # features meet at the same short-circuit.
    paused_state = schedule.task_state(dict(seasonal, paused=True))
    check("a paused seasonal routine reports no days left",
          (paused_state["status"], paused_state["daysLeft"]), ("paused", None))
    check("but still says when it would have been due",
          paused_state["due"], "2026-10-01")

    def _row(name, days, status="overdue", equipment=None):
        return {"task": {"name": name}, "equipment": equipment,
                "state": {"status": status, "daysLeft": days}}

    check("nothing overdue says nothing",
          schedule.overdue_notice([_row("Fine", 5, "ok")]), None)
    # Paused routines are not overdue, so they never reach the notice. That is
    # the two features meeting: pausing is meant to stop exactly this.
    check("and neither does a paused one",
          schedule.overdue_notice([_row("Set aside", None, "paused")]), None)

    one = schedule.overdue_notice([_row("Test Alarm", -1)])
    check("one overdue is counted as one", one[0], "1 overdue")
    check("and a single day is not pluralised", one[1], "- Test Alarm — due 1 day ago")

    many = schedule.overdue_notice([
        _row("Replace Furnace Filter", -30, equipment={"name": "Furnace"}),
        _row("Test Alarm", -16),
        _row("Due today", 0),
    ])
    check("several are counted", many[0], "3 overdue")
    check("the equipment is named when there is one",
          many[1].splitlines()[0], "- Replace Furnace Filter (Furnace) — due 30 days ago")
    check("and left out when there is not", many[1].splitlines()[1], "- Test Alarm — due 16 days ago")
    check("nothing is 0 days ago", many[1].splitlines()[2], "- Due today — due today")

    # A house with forty overdue routines should not get forty lines in a
    # notification drawer.
    lots = schedule.overdue_notice([_row(f"R{i}", -i - 1) for i in range(9)], limit=3)
    check("a long list is cut short", len(lots[1].splitlines()), 4)
    check("and says how much was left out", lots[1].splitlines()[-1], "...and 6 more")
    check("while still counting all of them", lots[0], "9 overdue")

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

    # --- doing the job ends the snooze ------------------------------------
    # The clearest possible signal that "not now" is over. Set to None rather
    # than removed, because normalize guarantees the key is there and a
    # record that lost it stopped matching its own export coming back in.
    await s.async_apply([("routine.put", {
        "id": "t3", "name": "Snoozed one", "lastDone": "2026-01-01",
        "intervalCount": 1, "intervalUnit": "months", "snoozedUntil": "2099-01-01",
    })])
    check("it starts asleep", s.task("t3")["snoozedUntil"], "2099-01-01")
    await s.async_complete("t3", done_on="2026-10-03")
    check("marking it done wakes it", s.task("t3")["snoozedUntil"], None)
    check("and the key is still there to be exported",
          "snoozedUntil" in s.task("t3"), True)

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
                # Never done. It used to count as "new"; now an interval with
                # nothing to count from is due today, which is what it is.
                {"id": "d", "name": "never done", "lastDone": None, "intervalCount": 1, "intervalUnit": "months"},
                # Genuinely unscheduled: the kind is set to months and no
                # month is ticked, so there is nothing to work out a date
                # from. This is all "new" means now.
                {"id": "f", "name": "no schedule", "schedule": "months", "months": [], "lastDone": None},
                # A one-off that has been done. Over, rather than overdue or
                # fine, and reporting no days left so nothing fires on it.
                {"id": "g", "name": "one-off done", "schedule": "date",
                 "onDate": schedule.add_interval(today, -5, "days"),
                 "onDateYearly": False, "lastDone": schedule.add_interval(today, -4, "days")},
                # Would be overdue by two months if it were not paused.
                {"id": "e", "name": "paused", "lastDone": schedule.add_interval(today, -90, "days"), "intervalCount": 1, "intervalUnit": "months", "paused": True},
            ],
            "supplies": [
                {"id": "s1", "name": "none left", "quantity": 0, "reorderAt": 1},
                {"id": "s2", "name": "at the floor", "quantity": 2, "reorderAt": 2},
                {"id": "s3", "name": "plenty", "quantity": 9, "reorderAt": 2},
            ],
        },
        merge=False,
    )
    # A paused routine is counted as paused and nowhere else. It would read as
    # overdue on its dates alone, so this is the check that pausing actually
    # stops the nagging rather than only changing how a row is drawn.
    check("counts", s.counts(), {"paused": 1, "snoozed": 0, "overdue": 1, "due": 2,
                                 "new": 1, "done": 1, "ok": 1, "lowStock": 2,
                                 "partsShort": 0, "equipment": 0})
    done_state = schedule.task_state(s.task("g"), s.due_soon_days)
    check("a finished one-off is done rather than overdue", done_state["status"], "done")
    check("and reports no days left, so nothing fires on it", done_state["daysLeft"], None)
    check("and has no next date, because there is not one", done_state["due"], None)
    paused_state = schedule.task_state(s.task("e"), s.due_soon_days)
    check("a paused routine reports no days left", paused_state["daysLeft"], None)
    check("which is what keeps a numeric condition from matching it",
          paused_state["status"], "paused")
    # The date survives, so the panel can say what was paused rather than only
    # that something was.
    check("but it still knows when it would have been due", bool(paused_state["due"]), True)
    # Overdue, then the two due ones soonest-first — the never-done routine
    # is due today and so comes before the one due in a few days — then the
    # unscheduled one, then fine, then finished, then paused. The last two
    # sort to the bottom on purpose: neither is waiting for anything.
    check("urgency order", [r["task"]["id"] for r in s.rows()],
          ["a", "d", "b", "f", "c", "g", "e"])
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
                # Never done, which now means due today rather than not
                # scheduled — so its parts are needed, and this is the check
                # that the two moved together.
                {"id": "d", "name": "never done", "lastDone": None,
                 "intervalCount": 1, "intervalUnit": "months",
                 "partsUsed": [{"supplyId": "gasket", "quantity": 4}]},
                # Genuinely unscheduled: a kind chosen with nothing filled
                # in. Nothing is coming up for it, so its parts are not
                # needed and this is what the old never-done case tested.
                {"id": "e", "name": "no schedule", "schedule": "clocks",
                 "clocks": [], "lastDone": None,
                 "partsUsed": [{"supplyId": "washer", "quantity": 7}]},
            ],
            "supplies": [
                # Two on the shelf and well above its reorder point, yet three
                # are needed: a threshold alone would call this fine.
                {"id": "filter", "name": "Filter", "quantity": 2, "reorderAt": 0},
                {"id": "belt", "name": "Belt", "quantity": 1, "reorderAt": 0},
                {"id": "gasket", "name": "Gasket", "quantity": 0, "reorderAt": 0},
                {"id": "washer", "name": "Washer", "quantity": 0, "reorderAt": 0},
            ],
        },
        merge=False,
    )
    short = s.parts_short()
    by_name = {r["name"]: r for r in short}
    check("the parts the schedule actually needs are short",
          sorted(by_name), ["Filter", "Gasket"])
    check("and the one nothing is scheduled for is not",
          "Washer" in by_name, False)
    check("two routines sharing a part are added together",
          by_name["Filter"]["needed"], 3)
    check("against what is on the shelf", by_name["Filter"]["on_hand"], 2)
    check("leaving the shortfall", by_name["Filter"]["short"], 1)
    check("and it names the routines that want it",
          by_name["Filter"]["routines"], ["furnace filter", "second filter"])
    check("a routine never done needs its parts today",
          (by_name["Gasket"]["needed"], by_name["Gasket"]["routines"]),
          (4, ["never done"]))
    check("the count follows", s.counts()["partsShort"], 2)
    # And the gap itself: the part that is short reads perfectly healthy by the
    # reorder point, because two on the shelf is above a threshold of zero.
    # Nothing but this check would have noticed.
    check("while the short part's own reorder point calls it fine",
          schedule.stock_status(s.supply("filter")), "ok")

    # Enough on the shelf and the shortfall goes away.
    await s.async_apply([("part.adjust", {"id": "filter", "delta": 1})])
    check("topping it up clears it",
          [r["name"] for r in s.parts_short()], ["Gasket"])

    # A part deleted out from under a routine must not raise.
    await s.async_apply([("part.delete", {"id": "filter"})])
    await s.async_apply([("part.delete", {"id": "gasket"})])
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
