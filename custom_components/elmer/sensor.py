"""Entities, so the rest of Home Assistant can act on this.

The panel is the place to read and edit. Entities exist for the other half:
automations, dashboards, and voice. Three summary sensors cover the house, and
each routine gets one sensor whose state is the number of days until it is due —
negative when overdue — grouped under a device per piece of equipment so the
furnace's routines sit together.

Days-until is the state rather than the due date because it is what a condition
wants to compare: ``below: 0`` is overdue and ``below: 7`` is next week, with no
template needed. The date is an attribute for display.

Routines added in the panel appear as entities without a restart. A deleted one
goes unavailable rather than vanishing, because an entity that disappears takes
any automation referring to it down silently; this way the automation shows a
clearly unavailable entity instead. Removing it for good is a job for the entity
registry, which is where people expect to do that.
"""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CATEGORIES, DOMAIN, PANEL_TITLE
from .store import ElmerStore
from . import schedule

STATUS_ICON = {
    "overdue": "mdi:alert-circle",
    "due": "mdi:clock-alert-outline",
    "new": "mdi:help-circle-outline",
    "ok": "mdi:check-circle-outline",
}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    store: ElmerStore = hass.data[DOMAIN][entry.entry_id]

    async_add_entities(
        [
            ElmerCountSensor(store, entry, "overdue", "Overdue", "mdi:alert-circle"),
            ElmerCountSensor(store, entry, "due", "Due soon", "mdi:clock-alert-outline"),
            ElmerCountSensor(store, entry, "lowStock", "Parts to reorder", "mdi:package-variant"),
            ElmerNextDueSensor(store, entry),
        ]
    )

    known: set[str] = set()

    @callback
    def sync_routines() -> None:
        """Add entities for new routines; the registry drops removed ones."""
        current = {t["id"] for t in store.data["tasks"] if t.get("id")}
        new = current - known
        if new:
            known.update(new)
            async_add_entities(
                [ElmerRoutineSensor(store, entry, tid) for tid in sorted(new)]
            )

    sync_routines()
    entry.async_on_unload(store.add_listener(sync_routines))


class ElmerEntity(SensorEntity):
    """Shared plumbing: never polls, repaints when the store says so."""

    _attr_should_poll = False
    _attr_has_entity_name = True

    def __init__(self, store: ElmerStore, entry: ConfigEntry) -> None:
        self._store = store
        self._entry = entry

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._store.add_listener(self.async_write_ha_state))

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=PANEL_TITLE,
            manufacturer="Elmer",
        )


class ElmerCountSensor(ElmerEntity):
    """How many things are in a given state."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "items"

    def __init__(self, store, entry, key: str, name: str, icon: str) -> None:
        super().__init__(store, entry)
        self._key = key
        self._attr_name = name
        self._attr_icon = icon
        self._attr_unique_id = f"{entry.entry_id}_{key}"

    @property
    def native_value(self) -> int:
        return self._store.counts().get(self._key, 0)

    @property
    def extra_state_attributes(self) -> dict:
        """The names behind the number, so a notification can say what is wrong."""
        if self._key == "lowStock":
            items = [
                {
                    "name": s.get("name"),
                    "quantity": s.get("quantity"),
                    "reorderAt": s.get("reorderAt"),
                    "status": schedule.stock_status(s),
                }
                for s in self._store.data["supplies"]
                if schedule.stock_status(s) != "ok"
            ]
            return {"parts": items, "names": [i["name"] for i in items]}

        rows = [r for r in self._store.rows() if r["state"]["status"] == self._key]
        items = [
            {
                "name": r["task"].get("name"),
                "equipment": (r["equipment"] or {}).get("name"),
                "due": r["state"]["due"],
                "days_left": r["state"]["daysLeft"],
            }
            for r in rows
        ]
        return {
            "routines": items,
            "names": [
                f"{i['equipment']}: {i['name']}" if i["equipment"] else i["name"] for i in items
            ],
        }


class ElmerNextDueSensor(ElmerEntity):
    """The soonest thing that isn't already overdue — one glanceable number."""

    _attr_name = "Next due"
    _attr_icon = "mdi:calendar-clock"
    _attr_native_unit_of_measurement = "d"

    def __init__(self, store, entry) -> None:
        super().__init__(store, entry)
        self._attr_unique_id = f"{entry.entry_id}_next_due"

    def _next(self) -> dict | None:
        upcoming = [
            r
            for r in self._store.rows()
            if r["state"]["daysLeft"] is not None and r["state"]["daysLeft"] >= 0
        ]
        upcoming.sort(key=lambda r: r["state"]["daysLeft"])
        return upcoming[0] if upcoming else None

    @property
    def native_value(self) -> int | None:
        row = self._next()
        return row["state"]["daysLeft"] if row else None

    @property
    def extra_state_attributes(self) -> dict:
        row = self._next()
        if not row:
            return {}
        return {
            "routine": row["task"].get("name"),
            "equipment": (row["equipment"] or {}).get("name"),
            "due": row["state"]["due"],
        }


class ElmerRoutineSensor(ElmerEntity):
    """Days until this routine is due. Negative means overdue."""

    _attr_native_unit_of_measurement = "d"

    def __init__(self, store: ElmerStore, entry: ConfigEntry, task_id: str) -> None:
        super().__init__(store, entry)
        self._task_id = task_id
        self._attr_unique_id = f"{entry.entry_id}_{task_id}"

    @property
    def _task(self) -> dict | None:
        return self._store.task(self._task_id)

    @property
    def available(self) -> bool:
        return self._task is not None

    @property
    def name(self) -> str | None:
        task = self._task
        return task.get("name") if task else None

    @property
    def device_info(self) -> DeviceInfo:
        """Group under the equipment, falling back to Elmer itself.

        A routine with no equipment still needs a home, and the integration's
        own device is the sensible one — otherwise the entity is orphaned.
        """
        task = self._task or {}
        eq = self._store.equipment(task.get("equipmentId"))
        if not eq:
            return super().device_info
        return DeviceInfo(
            identifiers={(DOMAIN, f"equipment_{eq['id']}")},
            name=eq.get("name") or "Equipment",
            manufacturer=eq.get("brand") or "Elmer",
            model=eq.get("model") or None,
            serial_number=eq.get("serial") or None,
            suggested_area=eq.get("location") or None,
            via_device=(DOMAIN, self._entry.entry_id),
        )

    @property
    def native_value(self) -> int | None:
        task = self._task
        if not task:
            return None
        return schedule.task_state(task, self._store.due_soon_days)["daysLeft"]

    @property
    def icon(self) -> str:
        task = self._task
        if not task:
            return "mdi:help-circle-outline"
        state = schedule.task_state(task, self._store.due_soon_days)
        return STATUS_ICON.get(state["status"], "mdi:wrench-outline")

    @property
    def extra_state_attributes(self) -> dict:
        task = self._task
        if not task:
            return {}
        state = schedule.task_state(task, self._store.due_soon_days)
        eq = self._store.equipment(task.get("equipmentId")) or {}
        return {
            "status": state["status"],
            "due": state["due"],
            "last_done": task.get("lastDone"),
            "interval": f"{task.get('intervalCount')} {task.get('intervalUnit')}",
            "progress": round(state["progress"], 3),
            "equipment": eq.get("name"),
            "location": eq.get("location"),
            "category": CATEGORIES.get(eq.get("category")),
            "part_number": eq.get("partNumber") or None,
            "routine_id": self._task_id,
        }
