"""Elmer's data, held in Home Assistant's own store.

Everything lives in ``.storage/elmer``, which Home Assistant already writes
atomically, backs up with the rest of the config, and restores on a snapshot
roll-back. Nothing is written to a path of our own, so there is no second thing
to remember to back up.

Mutations go through :meth:`ElmerStore.apply_op`, which applies one primitive
operation at a time — ``routine.lastDone``, ``part.adjust``, ``log.append``.
Expressing every change that way is what makes a batch atomic, an undo the exact
inverse of what was done rather than a guess, and the websocket API one validated
entry point instead of a method per screen.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any, Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .const import DEFAULT_DUE_SOON_DAYS, DOMAIN, STORAGE_KEY, STORAGE_VERSION
from . import schedule

_LOGGER = logging.getLogger(__name__)

IS_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

DEFAULT_SETTINGS: dict[str, Any] = {
    "theme": "system",
    "showLocations": True,
    "textSize": "default",
    "dueSoonDays": DEFAULT_DUE_SOON_DAYS,
    # Home Assistant handles delivery, so notification settings from an older
    # file are not carried over. They stay in the data untouched if an import
    # brought them in.
    "notifyOverdue": True,
}


def uid(prefix: str = "id") -> str:
    """Prefixed and random enough that ids minted here and in a browser at the
    same moment will not collide."""
    return f"{prefix}_{uuid.uuid4().hex[:14]}"


def _num(value: Any, default: float = 0) -> float:
    """``Number(x) || default`` — lenient in the same way the JavaScript is."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n != n:  # NaN
        return default
    return n


def _int(value: Any, default: int = 0) -> int:
    return int(_num(value, default))


def empty_data() -> dict[str, Any]:
    return {
        "version": STORAGE_VERSION,
        "equipment": [],
        "tasks": [],
        "supplies": [],
        "log": [],
        "settings": dict(DEFAULT_SETTINGS),
    }


def normalize(raw: Any) -> dict[str, Any]:
    """Merge whatever came off disk into a known-good shape.

    Carries the migrations with it, so a file exported by any earlier version
    imports cleanly: ``links`` becomes ``parts``, a single ``contact`` field is
    routed to ``phone`` or ``email`` by whether it looks like an address, and a
    part number that used to sit on a routine is lifted to its equipment.
    """
    base = empty_data()
    if not isinstance(raw, dict):
        return base

    raw_tasks = raw.get("tasks") if isinstance(raw.get("tasks"), list) else []

    equipment = []
    for e in raw.get("equipment") or []:
        if not isinstance(e, dict):
            continue
        item = dict(e)
        inherited = next(
            (
                t.get("partNumber")
                for t in raw_tasks
                if isinstance(t, dict)
                and t.get("equipmentId") == e.get("id")
                and t.get("partNumber")
            ),
            "",
        )
        links = e.get("parts") if isinstance(e.get("parts"), list) else e.get("links")
        item["parts"] = links if isinstance(links, list) else []
        item["manualUrl"] = e.get("manualUrl") or None
        contact = (e.get("contact") or "").strip() if isinstance(e.get("contact"), str) else ""
        looks_like_email = bool(contact and IS_EMAIL.match(contact))
        item["phone"] = e.get("phone") or ("" if looks_like_email else contact)
        item["email"] = e.get("email") or (contact if looks_like_email else "")
        item["partNumber"] = e.get("partNumber") or inherited or ""
        item.pop("links", None)
        item.pop("contact", None)
        equipment.append(item)

    tasks = []
    for t in raw_tasks:
        if not isinstance(t, dict):
            continue
        item = {k: v for k, v in t.items() if k != "partNumber"}
        used = t.get("partsUsed") if isinstance(t.get("partsUsed"), list) else []
        item["partsUsed"] = [
            {"supplyId": u.get("supplyId"), "quantity": max(1, _int(u.get("quantity"), 1))}
            for u in used
            if isinstance(u, dict) and u.get("supplyId")
        ]
        tasks.append(item)

    supplies = []
    for p in raw.get("supplies") or []:
        if not isinstance(p, dict):
            continue
        item = dict(p)
        item["quantity"] = _int(p.get("quantity"), 0)
        item["reorderAt"] = _int(p.get("reorderAt"), 0)
        supplies.append(item)

    settings = dict(base["settings"])
    if isinstance(raw.get("settings"), dict):
        settings.update(raw["settings"])
    settings["dueSoonDays"] = max(0, _int(settings.get("dueSoonDays"), DEFAULT_DUE_SOON_DAYS))

    return {
        "version": STORAGE_VERSION,
        "equipment": equipment,
        "tasks": tasks,
        "supplies": supplies,
        "log": raw.get("log") if isinstance(raw.get("log"), list) else [],
        "settings": settings,
    }


def _upsert(items: list[dict], record: dict) -> list[dict]:
    """Merge by id, matching the journal's upsert: a put patches, never replaces.

    A partial record from the panel — one changed field — must not blank the
    rest, and two devices editing different fields of the same routine must both
    survive the fold.
    """
    out = list(items)
    for i, existing in enumerate(out):
        if existing.get("id") == record.get("id"):
            out[i] = {**existing, **record}
            return out
    out.append(dict(record))
    return out


class ElmerStore:
    """Loads, holds and mutates the data, and tells everyone when it changed."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = empty_data()
        self._listeners: list[Callable[[], None]] = []
        self._dirty = False

    async def async_load(self) -> None:
        raw = await self._store.async_load()
        self.data = normalize(raw)
        if raw is None:
            _LOGGER.debug("no stored data; starting empty")

    async def async_save(self) -> None:
        await self._store.async_save(self.data)
        self._dirty = False

    @callback
    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)

        def remove() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return remove

    @callback
    def _notify(self) -> None:
        for cb in list(self._listeners):
            try:
                cb()
            except Exception:  # noqa: BLE001 — one bad listener must not stop the rest
                _LOGGER.exception("Elmer listener failed")

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    @property
    def due_soon_days(self) -> int:
        return max(0, _int(self.data["settings"].get("dueSoonDays"), DEFAULT_DUE_SOON_DAYS))

    def task(self, task_id: str) -> dict | None:
        return next((t for t in self.data["tasks"] if t.get("id") == task_id), None)

    def equipment(self, equipment_id: str) -> dict | None:
        return next((e for e in self.data["equipment"] if e.get("id") == equipment_id), None)

    def supply(self, supply_id: str) -> dict | None:
        return next((s for s in self.data["supplies"] if s.get("id") == supply_id), None)

    def rows(self) -> list[dict]:
        """Every routine with its computed state, most urgent first."""
        soon = self.due_soon_days
        out = [
            {"task": t, "state": schedule.task_state(t, soon), "equipment": self.equipment(t.get("equipmentId"))}
            for t in self.data["tasks"]
        ]
        out.sort(key=schedule.sort_key)
        return out

    def parts_short(self) -> list[dict]:
        """Parts the routines coming up need more of than are on the shelf.

        This is a different question from the reorder point, which is a standing
        threshold on a part and knows nothing about the schedule: not which
        routines use the part, nor how many each takes, nor when they are next
        due. A part can sit comfortably above its threshold and still be one
        short of what next week actually needs — and two routines sharing a
        filter are counted together here, which a per-part threshold cannot see
        at all.

        Overdue routines count: still undone, still needing the part. A routine
        that has never been done has no due date, so nothing is coming up for it
        and it is left out rather than counted as needed now.
        """
        soon = self.due_soon_days
        needed: dict[str, int] = {}
        wanted_by: dict[str, list[str]] = {}

        for t in self.data["tasks"]:
            if schedule.task_state(t, soon)["status"] not in ("overdue", "due"):
                continue
            for u in t.get("partsUsed") or []:
                supply_id = u.get("supplyId")
                qty = max(0, _int(u.get("quantity"), 0))
                if not supply_id or qty <= 0:
                    continue
                needed[supply_id] = needed.get(supply_id, 0) + qty
                wanted_by.setdefault(supply_id, []).append(t.get("name") or "")

        out = []
        for supply_id, want in needed.items():
            supply = self.supply(supply_id)
            if not supply:
                continue                      # the part was deleted out from under it
            have = max(0, _int(supply.get("quantity"), 0))
            if want <= have:
                continue
            out.append(
                {
                    "name": supply.get("name"),
                    "needed": want,
                    "on_hand": have,
                    "short": want - have,
                    "routines": sorted(n for n in wanted_by.get(supply_id, []) if n),
                }
            )

        # Worst shortfall first, so a notification that truncates keeps the
        # thing most worth ordering.
        out.sort(key=lambda r: (-r["short"], str(r["name"] or "").lower()))
        return out

    def counts(self) -> dict[str, int]:
        rows = self.rows()
        return {
            "overdue": sum(1 for r in rows if r["state"]["status"] == "overdue"),
            "due": sum(1 for r in rows if r["state"]["status"] == "due"),
            "new": sum(1 for r in rows if r["state"]["status"] == "new"),
            "ok": sum(1 for r in rows if r["state"]["status"] == "ok"),
            "lowStock": sum(
                1 for s in self.data["supplies"] if schedule.stock_status(s) != "ok"
            ),
            "partsShort": len(self.parts_short()),
            "equipment": len(self.data["equipment"]),
        }

    def find_task_by_name(self, name: str) -> dict | None:
        """Match a routine the way a person would type it into a service call.

        Exact id first, then a case-insensitive name, then ``Equipment: routine``
        so two 'Replace filter' routines on different equipment can be told
        apart. Ambiguity is refused by the caller, not guessed at here.
        """
        needle = (name or "").strip().lower()
        if not needle:
            return None
        by_id = self.task(name)
        if by_id:
            return by_id
        matches = [t for t in self.data["tasks"] if (t.get("name") or "").strip().lower() == needle]
        if len(matches) == 1:
            return matches[0]
        for t in self.data["tasks"]:
            eq = self.equipment(t.get("equipmentId")) or {}
            label = f"{eq.get('name', '')}: {t.get('name', '')}".strip().lower()
            if label == needle:
                return t
        if matches:
            raise ValueError(
                f"{len(matches)} routines are called {name!r}. "
                "Use 'Equipment name: Routine name' instead."
            )
        return None

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    def apply_op(self, kind: str, payload: dict, at: int | None = None) -> None:
        """Apply one primitive operation. A port of ``applyOp`` in journal.cjs.

        Unknown kinds are ignored rather than raising, matching the JavaScript,
        so a newer panel asking for something this build has never heard of
        degrades instead of erroring.
        """
        at = at if at is not None else int(time.time() * 1000)
        p = payload or {}
        d = self.data

        if kind == "equipment.put":
            d["equipment"] = _upsert(d["equipment"], p)
        elif kind == "equipment.delete":
            d["equipment"] = [e for e in d["equipment"] if e.get("id") != p.get("id")]
            d["tasks"] = [t for t in d["tasks"] if t.get("equipmentId") != p.get("id")]

        elif kind == "routine.put":
            d["tasks"] = _upsert(d["tasks"], p)
        elif kind == "routine.delete":
            d["tasks"] = [t for t in d["tasks"] if t.get("id") != p.get("id")]
        elif kind == "routine.lastDone":
            for t in d["tasks"]:
                if t.get("id") == p.get("id"):
                    t["lastDone"] = p.get("doneOn")

        elif kind == "part.put":
            d["supplies"] = _upsert(d["supplies"], p)
        elif kind == "part.delete":
            d["supplies"] = [s for s in d["supplies"] if s.get("id") != p.get("id")]
        elif kind == "part.adjust":
            for s in d["supplies"]:
                if s.get("id") == p.get("id"):
                    s["quantity"] = max(0, _int(s.get("quantity"), 0) + _int(p.get("delta"), 0))
                    s["updatedAt"] = at

        elif kind == "log.append":
            if not any(l.get("id") == p.get("id") for l in d["log"]):
                d["log"].insert(0, dict(p))
        elif kind == "log.remove":
            d["log"] = [l for l in d["log"] if l.get("id") != p.get("id")]

        elif kind == "settings.put":
            d["settings"].update(p)

        else:
            _LOGGER.debug("ignoring unknown op kind %s", kind)
            return

        self._dirty = True

    async def async_apply(self, ops: list[tuple[str, dict]]) -> None:
        """Apply a batch, then save and notify once."""
        at = int(time.time() * 1000)
        for kind, payload in ops:
            self.apply_op(kind, payload, at)
        if self._dirty:
            await self.async_save()
            self._notify()

    async def async_complete(
        self,
        task_id: str,
        done_on: str | None = None,
        notes: str = "",
        cost: str = "",
        used: list[dict] | None = None,
    ) -> dict | None:
        """Mark a routine done, draw down its parts, and write a history entry.

        A port of ``completeTask``. The amount recorded on the log entry is what
        was *actually* taken, capped at what was on the shelf — a routine that
        needs nine of something you have five of takes five and records five, so
        undoing it does not invent four units of stock.
        """
        task = self.task(task_id)
        if not task:
            return None

        done_on = done_on or schedule.today()
        wanted = used if used is not None else (task.get("partsUsed") or [])

        taken = []
        for u in wanted:
            supply = self.supply(u.get("supplyId"))
            if not supply:
                continue
            want = max(0, _int(u.get("quantity"), 0))
            have = max(0, _int(supply.get("quantity"), 0))
            qty = min(want, have)
            if qty > 0:
                taken.append({"supplyId": u["supplyId"], "quantity": qty})

        entry = {
            "id": uid("log"),
            "taskId": task_id,
            "equipmentId": task.get("equipmentId"),
            "taskName": task.get("name"),
            "doneOn": done_on,
            "notes": notes or "",
            "cost": cost or "",
            "recordedAt": int(time.time() * 1000),
            "previousLastDone": task.get("lastDone") or None,
            "usedParts": taken,
        }

        ops: list[tuple[str, dict]] = [("routine.lastDone", {"id": task_id, "doneOn": done_on})]
        for u in taken:
            ops.append(("part.adjust", {"id": u["supplyId"], "delta": -u["quantity"]}))
        ops.append(("log.append", entry))

        await self.async_apply(ops)
        return entry

    async def async_undo(self, log_id: str) -> dict | None:
        """Reverse a completion, putting back exactly what it took."""
        entry = next((l for l in self.data["log"] if l.get("id") == log_id), None)
        if not entry:
            return None
        ops: list[tuple[str, dict]] = [
            ("routine.lastDone", {"id": entry.get("taskId"), "doneOn": entry.get("previousLastDone")})
        ]
        for u in entry.get("usedParts") or []:
            ops.append(("part.adjust", {"id": u.get("supplyId"), "delta": _int(u.get("quantity"), 0)}))
        ops.append(("log.remove", {"id": log_id}))
        await self.async_apply(ops)
        return entry

    async def async_replace(self, raw: Any, merge: bool = False) -> dict[str, int]:
        """Import an exported backup.

        With ``merge`` the incoming records are upserted by id, so re-importing
        a newer export updates in place and nothing already here is lost. Without
        it, the import replaces everything.
        """
        incoming = normalize(raw)
        if not merge:
            self.data = incoming
            self._dirty = True
            await self.async_save()
            self._notify()
        else:
            ops: list[tuple[str, dict]] = [("settings.put", incoming["settings"])]
            ops += [("equipment.put", e) for e in incoming["equipment"]]
            ops += [("routine.put", t) for t in incoming["tasks"]]
            ops += [("part.put", s) for s in incoming["supplies"]]
            # Oldest first, because log.append prepends.
            ops += [("log.append", l) for l in reversed(incoming["log"])]
            await self.async_apply(ops)

        return {
            "equipment": len(incoming["equipment"]),
            "routines": len(incoming["tasks"]),
            "parts": len(incoming["supplies"]),
            "history": len(incoming["log"]),
        }

    def export(self) -> dict[str, Any]:
        """The same shape :meth:`async_replace` reads, so a round trip is lossless."""
        return {
            "version": STORAGE_VERSION,
            "equipment": self.data["equipment"],
            "tasks": self.data["tasks"],
            "supplies": self.data["supplies"],
            "log": self.data["log"],
            "settings": self.data["settings"],
            "exportedAt": int(time.time() * 1000),
            "exportedBy": DOMAIN,
        }
