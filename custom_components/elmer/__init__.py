"""Elmer — home maintenance tracking, in the Home Assistant sidebar."""

from __future__ import annotations

import json
import logging
import os

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    FRONTEND_URL,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
)
from .services import async_setup_services, async_unload_services
from .store import ElmerStore
from .websocket import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]

# Elmer is set up from the interface; there is nothing to put in YAML. This is
# the declaration that says so, and it makes Home Assistant warn rather than
# silently ignore an `elmer:` key somebody adds to configuration.yaml.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


def _integration_version() -> str:
    """Read the version out of our own manifest, for cache busting."""
    try:
        path = os.path.join(os.path.dirname(__file__), "manifest.json")
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("version", "0")
    except (OSError, ValueError):
        return "0"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Nothing to do here — Elmer is set up from a config entry."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = ElmerStore(hass)
    await store.async_load()

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data[entry.entry_id] = store

    # The panel and the websocket commands are global rather than per-entry, and
    # Elmer is single-instance, but a reload calls this again — so both are
    # guarded. Registering a static path twice raises.
    if not domain_data.get("_frontend"):
        await _async_register_frontend(hass)
        domain_data["_frontend"] = True

    if not domain_data.get("_ws"):
        async_register_websocket_api(hass)
        domain_data["_ws"] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_setup_services(hass)
    return True


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the panel's files and put Elmer in the sidebar."""
    here = os.path.dirname(__file__)
    frontend_dir = os.path.join(here, "frontend")

    # async_register_static_paths replaced register_static_path in 2025.7; the
    # old call now raises a blocking-I/O error rather than working.
    #
    # cache_headers=False on purpose. The panel is a handful of kilobytes, and
    # only its entry point carries a version in its URL — the modules it imports
    # are plain relative paths. With long cache headers an update could hand a
    # browser a fresh entry point and stale modules, which fails in ways that
    # look like nothing is wrong. Re-fetching a few kilobytes is the cheaper
    # side of that trade.
    await hass.http.async_register_static_paths(
        [StaticPathConfig(FRONTEND_URL, frontend_dir, cache_headers=False)]
    )

    version = _integration_version()
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_COMPONENT,
        module_url=f"{FRONTEND_URL}/elmer-panel.js?v={version}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={"version": version},
    )
    _LOGGER.debug("Elmer panel registered at /%s (v%s)", PANEL_URL, version)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        # The sidebar panel and the static route stay registered. Removing the
        # panel here and re-adding it on reload makes the sidebar flicker and
        # drops anyone who has it open; a restart clears both anyway.
        if not any(k for k in hass.data[DOMAIN] if not k.startswith("_")):
            async_unload_services(hass)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Take the sidebar entry away when Elmer is deleted outright.

    Wrapped because this is cosmetic: if the helper has moved, the panel simply
    lingers until the next restart, which is a far better outcome than a
    traceback on an otherwise clean removal.
    """
    try:
        frontend.async_remove_panel(hass, PANEL_URL)
    except Exception:  # noqa: BLE001
        _LOGGER.debug("could not remove the Elmer panel; it will go on restart", exc_info=True)
