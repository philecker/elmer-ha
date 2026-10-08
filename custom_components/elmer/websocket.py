"""What the panel talks to.

Home Assistant already holds an authenticated websocket open to every browser
showing the sidebar, so the panel uses that rather than any endpoint of our own.
Nothing new is exposed to the network, and remote access through Nabu Casa needs
no extra configuration — it is the same connection the rest of the interface
uses.

Three commands:

``elmer/get``       the whole state, plus computed status for every routine
``elmer/subscribe`` the same, pushed again whenever anything changes
``elmer/apply``     a batch of primitive operations

``elmer/apply`` takes primitive operations rather than offering a method per
screen. One validated entry point covers every edit the panel can make, which is
what keeps the surface small enough to reason about.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from . import schedule

_LOGGER = logging.getLogger(__name__)

# Operations the panel is allowed to send. Anything else is refused rather than
# ignored: unlike a journal arriving from another device, a bad op from the panel
# is a bug worth surfacing.
ALLOWED_OPS = {
    "equipment.put",
    "equipment.delete",
    "routine.put",
    "routine.delete",
    "routine.lastDone",
    "part.put",
    "part.delete",
    "part.adjust",
    "log.append",
    "log.remove",
    "settings.put",
}

OP_SCHEMA = vol.Schema(
    {
        vol.Required("kind"): vol.In(sorted(ALLOWED_OPS)),
        vol.Required("payload"): dict,
    }
)


def _store(hass: HomeAssistant):
    """The single store, whatever its entry id is."""
    for key, value in (hass.data.get(DOMAIN) or {}).items():
        if not key.startswith("_"):
            return value
    return None


def _snapshot(store) -> dict[str, Any]:
    """Everything the panel needs for a first paint, in one message.

    Status is computed here rather than in the browser so the sidebar, the
    sensors and any automation can never disagree about whether something is
    overdue — and so a phone that has been asleep since yesterday does not paint
    a stale 'due tomorrow' from its own clock.
    """
    data = store.data
    soon = store.due_soon_days
    return {
        "equipment": data["equipment"],
        "tasks": data["tasks"],
        "supplies": data["supplies"],
        "log": data["log"],
        "settings": data["settings"],
        "computed": {
            "today": schedule.today(),
            "dueSoonDays": soon,
            "states": {
                t["id"]: schedule.task_state(t, soon) for t in data["tasks"] if t.get("id")
            },
            "stock": {
                s["id"]: schedule.stock_status(s) for s in data["supplies"] if s.get("id")
            },
            "counts": store.counts(),
        },
    }


@callback
def async_register_websocket_api(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_apply)
    websocket_api.async_register_command(hass, ws_complete)
    websocket_api.async_register_command(hass, ws_undo)
    websocket_api.async_register_command(hass, ws_import)


@websocket_api.websocket_command({vol.Required("type"): "elmer/get"})
@callback
def ws_get(hass: HomeAssistant, connection, msg: dict) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return
    connection.send_result(msg["id"], _snapshot(store))


@websocket_api.websocket_command({vol.Required("type"): "elmer/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection, msg: dict) -> None:
    """Push the whole state on every change.

    Sending everything rather than a diff is a deliberate trade. One person's
    maintenance data is a few tens of kilobytes at most, and a full snapshot
    cannot drift out of step with the browser's copy the way a missed or
    out-of-order patch can.
    """
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return

    @callback
    def push() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], _snapshot(store))
        )

    connection.subscriptions[msg["id"]] = store.add_listener(push)
    connection.send_result(msg["id"])
    push()


@websocket_api.websocket_command(
    {
        vol.Required("type"): "elmer/apply",
        vol.Required("ops"): vol.All([OP_SCHEMA], vol.Length(min=1, max=500)),
    }
)
@websocket_api.async_response
async def ws_apply(hass: HomeAssistant, connection, msg: dict) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return
    try:
        await store.async_apply([(op["kind"], op["payload"]) for op in msg["ops"]])
    except Exception as err:  # noqa: BLE001
        _LOGGER.exception("Elmer could not apply a change from the panel")
        connection.send_error(msg["id"], "apply_failed", str(err))
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "elmer/complete",
        vol.Required("taskId"): str,
        vol.Optional("doneOn"): vol.Any(str, None),
        vol.Optional("notes", default=""): str,
        vol.Optional("cost", default=""): str,
        vol.Optional("used"): vol.Any([dict], None),
    }
)
@websocket_api.async_response
async def ws_complete(hass: HomeAssistant, connection, msg: dict) -> None:
    """Completing is its own command, not a batch of ops.

    Marking a routine done, drawing down the parts it consumes and writing the
    history entry have to happen together or not at all, and the amount drawn
    down depends on what is in stock at that moment. Leaving that arithmetic to
    the browser is how stock and history drift apart.
    """
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return
    entry = await store.async_complete(
        msg["taskId"],
        done_on=msg.get("doneOn"),
        notes=msg.get("notes", ""),
        cost=msg.get("cost", ""),
        used=msg.get("used"),
    )
    if entry is None:
        connection.send_error(msg["id"], "not_found", "No such routine")
        return
    connection.send_result(msg["id"], {"entry": entry})


@websocket_api.websocket_command(
    {vol.Required("type"): "elmer/undo", vol.Required("logId"): str}
)
@websocket_api.async_response
async def ws_undo(hass: HomeAssistant, connection, msg: dict) -> None:
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return
    entry = await store.async_undo(msg["logId"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "No such history entry")
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "elmer/import",
        vol.Required("data"): dict,
        vol.Optional("merge", default=True): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import(hass: HomeAssistant, connection, msg: dict) -> None:
    """Take a backup the panel read in the browser.

    The file is parsed in the browser and sent as JSON, so nothing has to be
    placed on the server first — which is what makes this work from a phone over
    Nabu Casa as well as it does at home.

    Admin only. Everything else here edits one record at a time; this can replace
    the whole data set, so it is held to the same bar as a configuration change
    rather than to the bar of ticking a routine off.
    """
    store = _store(hass)
    if store is None:
        connection.send_error(msg["id"], "not_loaded", "Elmer is not set up")
        return
    try:
        counts = await store.async_replace(msg["data"], merge=msg.get("merge", True))
    except Exception as err:  # noqa: BLE001
        _LOGGER.exception("Elmer could not import the file the panel sent")
        connection.send_error(msg["id"], "import_failed", str(err))
        return
    _LOGGER.info("Imported from the panel (merge=%s): %s", msg.get("merge", True), counts)
    connection.send_result(msg["id"], {"counts": counts})
