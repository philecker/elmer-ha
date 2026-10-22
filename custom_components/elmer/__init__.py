"""Elmer — home maintenance tracking, in the Home Assistant sidebar."""

from __future__ import annotations

import json
import logging
import os

from homeassistant.components import frontend, panel_custom, persistent_notification
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    FRONTEND_URL,
    PANEL_COMPONENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    SIDEBAR_ICON_FILE,
)
from . import schedule
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

    entry.async_on_unload(_async_watch_overdue(hass, store))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await async_setup_services(hass)
    return True


NOTIFICATION_ID = "elmer_overdue"


def _async_watch_overdue(hass: HomeAssistant, store: ElmerStore):
    """Keep one persistent notification in step with what is overdue.

    Home Assistant gives a custom panel's own sidebar row no badge — only
    Notifications and Configuration carry one, both from HA's own data — so a
    persistent notification is the nearest thing, and it badges the
    Notifications row rather than Elmer's.

    One notification with a fixed id, so it is replaced rather than stacked:
    ticking something off edits the message instead of leaving a drift of
    stale ones behind. It is dismissed the moment nothing is overdue, and the
    moment the setting is turned off, so turning it off is immediate rather
    than taking effect next time something changes.
    """

    @callback
    def refresh() -> None:
        try:
            if not store.data["settings"].get("badgeOverdue"):
                persistent_notification.async_dismiss(hass, NOTIFICATION_ID)
                return
            notice = schedule.overdue_notice(store.rows())
            if notice is None:
                persistent_notification.async_dismiss(hass, NOTIFICATION_ID)
                return
            title, message = notice
            persistent_notification.async_create(
                hass, message, title=f"Elmer: {title}", notification_id=NOTIFICATION_ID
            )
        except Exception:  # noqa: BLE001
            # A badge is the least important thing Elmer does. It must never be
            # the reason a save fails.
            _LOGGER.exception("could not update the Elmer overdue notification")

    refresh()
    remove = store.add_listener(refresh)

    def stop() -> None:
        remove()
        persistent_notification.async_dismiss(hass, NOTIFICATION_ID)

    return stop


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Serve the panel's files and put Elmer in the sidebar."""
    here = os.path.dirname(__file__)
    frontend_dir = os.path.join(here, "frontend")

    version = _integration_version()

    # The version goes in the PATH, not in a query string, and this is the
    # whole reason the panel can be updated without breaking.
    #
    # It used to be `elmer-panel.js?v=1.4.0`, with the modules that file
    # imports left as plain relative paths. Those imports resolve against the
    # directory, so they carried no version at all. Home Assistant's service
    # worker caches what it likes regardless of our cache headers, so after an
    # update a browser could fetch the new entry point — a new URL, so a real
    # fetch — and then satisfy `./views.js` from the worker's copy of the old
    # one. A new entry point importing a name an old module does not export is
    # a module that never evaluates, so the custom element is never defined
    # and the panel is simply blank. No error in the log, because nothing on
    # the Home Assistant side went wrong.
    #
    # Under a versioned directory every import is versioned for free: 1.5.0's
    # entry point can only ever reach 1.5.0's modules, because that is the
    # only place its relative paths lead.
    #
    # cache_headers stays off even so. A versioned path would make caching
    # safe, but files are routinely swapped in place during development
    # without the version changing, and a cached stale panel is a confusing
    # hour. A few kilobytes per load is the cheaper side of that trade.
    #
    # async_register_static_paths replaced register_static_path in 2025.7; the
    # old call now raises a blocking-I/O error rather than working.
    served_at = f"{FRONTEND_URL}/{version}"

    # The sidebar takes an icon name, never an image, so showing Elmer's own
    # mark there means registering an icon set the name can point at. That has
    # to happen on every page, since the sidebar is drawn whether or not
    # anybody opens the panel — which is what add_extra_js_url is for, and it
    # is the one thing Elmer puts on pages that are nothing to do with it. The
    # file is a couple of kilobytes and holds one path.
    #
    # Its URL carries no version, and that is the opposite of the panel's for
    # a reason.
    #
    # add_extra_js_url writes the URL into the Home Assistant index page,
    # server side. Home Assistant's service worker serves that page
    # StaleWhileRevalidate — the catch-all route in its frontend's
    # service-worker.ts — so the first load after any change gets the previous
    # copy of the index and refreshes it behind. For one page load, then, the
    # URL Elmer asked for is the one it was asking for before the update.
    #
    # Under a versioned path that URL is a 404: the old version's directory is
    # not registered any more. Nothing registers the icon set, and a custom
    # panel's sidebar row has no icon for the life of that page — the symptom
    # being an icon that goes missing after an update and comes back on the
    # next load. Under a stable path the stale index names a file that still
    # exists.
    #
    # Safe for this file where it was not safe for the panel, because the two
    # fail differently. A stale icon script is a standalone script with no
    # imports and no exports anybody reads, so the worst it can do is draw the
    # previous mark for a load. A stale panel module gets paired with a new
    # entry point and the import graph breaks, which is what made 1.5.0 blank.
    #
    # Registered as a file rather than a directory, so it is one exact route
    # and cannot shadow the versioned directory beside it.
    icon_url = f"{FRONTEND_URL}/{SIDEBAR_ICON_FILE}"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(served_at, frontend_dir, cache_headers=False),
            StaticPathConfig(
                icon_url,
                os.path.join(frontend_dir, SIDEBAR_ICON_FILE),
                cache_headers=False,
            ),
        ]
    )
    frontend.add_extra_js_url(hass, icon_url)

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_COMPONENT,
        module_url=f"{served_at}/elmer-panel.js",
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

    # The icon set is the one thing Elmer loads on pages that are nothing to do
    # with it, so it should stop being loaded the moment Elmer is gone rather
    # than waiting for a restart. Removed by the same URL it was added under,
    # which no longer depends on which version happens to be installed.
    # Wrapped for the same reason as the panel above.
    try:
        frontend.remove_extra_js_url(hass, f"{FRONTEND_URL}/{SIDEBAR_ICON_FILE}")
    except Exception:  # noqa: BLE001
        _LOGGER.debug("could not unregister the Elmer icon set", exc_info=True)
