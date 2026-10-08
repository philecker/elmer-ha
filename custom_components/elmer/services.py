"""Services, so an automation or a voice command can do what the panel does.

``elmer.complete`` takes a routine by name because that is what a person writes
in an automation — but a name can be ambiguous, and two routines called "Replace
filter" on different equipment must not be a coin toss. Where it is ambiguous the
call fails and says to qualify it as ``Furnace: Replace filter``. Nothing is
guessed.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN,
    SERVICE_ADJUST_STOCK,
    SERVICE_COMPLETE,
    SERVICE_EXPORT,
    SERVICE_IMPORT,
    SERVICE_UNDO,
)
from .store import ElmerStore

_LOGGER = logging.getLogger(__name__)

COMPLETE_SCHEMA = vol.Schema(
    {
        vol.Required("routine"): cv.string,
        vol.Optional("done_on"): cv.string,
        vol.Optional("notes", default=""): cv.string,
        vol.Optional("cost", default=""): cv.string,
    }
)

UNDO_SCHEMA = vol.Schema({vol.Optional("routine"): cv.string})

ADJUST_SCHEMA = vol.Schema(
    {
        vol.Required("part"): cv.string,
        vol.Required("delta"): vol.Coerce(int),
    }
)

IMPORT_SCHEMA = vol.Schema(
    {
        vol.Required("path"): cv.string,
        vol.Optional("merge", default=True): cv.boolean,
    }
)

EXPORT_SCHEMA = vol.Schema({vol.Optional("path"): cv.string})


def _store(hass: HomeAssistant) -> ElmerStore:
    for key, value in (hass.data.get(DOMAIN) or {}).items():
        if not key.startswith("_"):
            return value
    raise HomeAssistantError("Elmer is not set up")


def _resolve_task(store: ElmerStore, name: str) -> dict:
    try:
        task = store.find_task_by_name(name)
    except ValueError as err:
        raise ServiceValidationError(str(err)) from err
    if not task:
        raise ServiceValidationError(f"No routine called {name!r}")
    return task


def _safe_path(hass: HomeAssistant, path: str) -> str:
    """Keep file access inside the config directory.

    A service call is reachable from a script, a dashboard button and the voice
    assistant, so the path it is handed is not necessarily one the owner typed.
    Resolving it and refusing anything outside the config directory means this
    cannot be turned into a way to read or write arbitrary files on the host.
    """
    base = os.path.realpath(hass.config.path())
    target = os.path.realpath(
        path if os.path.isabs(path) else hass.config.path(path)
    )
    if target != base and not target.startswith(base + os.sep):
        raise ServiceValidationError(
            "The path has to be inside your Home Assistant config folder, "
            "for example 'elmer.json' or 'www/elmer.json'."
        )
    return target


async def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_COMPLETE):
        return

    async def complete(call: ServiceCall) -> None:
        store = _store(hass)
        task = _resolve_task(store, call.data["routine"])
        await store.async_complete(
            task["id"],
            done_on=call.data.get("done_on"),
            notes=call.data.get("notes", ""),
            cost=call.data.get("cost", ""),
        )

    async def undo(call: ServiceCall) -> None:
        """Undo the most recent completion, optionally for one routine."""
        store = _store(hass)
        log = store.data["log"]
        if routine := call.data.get("routine"):
            task = _resolve_task(store, routine)
            entry = next((l for l in log if l.get("taskId") == task["id"]), None)
            if not entry:
                raise ServiceValidationError(
                    f"{task.get('name')!r} has nothing recorded to undo"
                )
        else:
            if not log:
                raise ServiceValidationError("There is no history to undo")
            entry = log[0]
        await store.async_undo(entry["id"])

    async def adjust_stock(call: ServiceCall) -> None:
        store = _store(hass)
        needle = call.data["part"].strip().lower()
        matches = [
            s
            for s in store.data["supplies"]
            if (s.get("name") or "").strip().lower() == needle or s.get("id") == call.data["part"]
        ]
        if not matches:
            raise ServiceValidationError(f"No part called {call.data['part']!r}")
        if len(matches) > 1:
            raise ServiceValidationError(
                f"{len(matches)} parts are called {call.data['part']!r}; rename one so they can be told apart"
            )
        await store.async_apply(
            [("part.adjust", {"id": matches[0]["id"], "delta": call.data["delta"]})]
        )

    async def import_json(call: ServiceCall) -> ServiceResponse:
        store = _store(hass)
        path = _safe_path(hass, call.data["path"])

        def read() -> Any:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)

        try:
            raw = await hass.async_add_executor_job(read)
        except FileNotFoundError as err:
            raise ServiceValidationError(f"No file at {path}") from err
        except (OSError, ValueError) as err:
            raise ServiceValidationError(f"Could not read {path}: {err}") from err

        counts = await store.async_replace(raw, merge=call.data.get("merge", True))
        _LOGGER.info("Imported from %s: %s", path, counts)
        return counts

    async def export_json(call: ServiceCall) -> ServiceResponse:
        store = _store(hass)
        payload = store.export()
        if not (raw_path := call.data.get("path")):
            return {"data": payload}

        path = _safe_path(hass, raw_path)

        def write() -> None:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # Write beside the target and rename, so an interrupted export can
            # never leave a half-written file where a good backup used to be.
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
            os.replace(tmp, path)

        try:
            await hass.async_add_executor_job(write)
        except OSError as err:
            raise ServiceValidationError(f"Could not write {path}: {err}") from err
        return {"path": path}

    hass.services.async_register(DOMAIN, SERVICE_COMPLETE, complete, schema=COMPLETE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_UNDO, undo, schema=UNDO_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_ADJUST_STOCK, adjust_stock, schema=ADJUST_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT,
        import_json,
        schema=IMPORT_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_EXPORT,
        export_json,
        schema=EXPORT_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )


def async_unload_services(hass: HomeAssistant) -> None:
    for service in (
        SERVICE_COMPLETE,
        SERVICE_UNDO,
        SERVICE_ADJUST_STOCK,
        SERVICE_IMPORT,
        SERVICE_EXPORT,
    ):
        hass.services.async_remove(DOMAIN, service)
