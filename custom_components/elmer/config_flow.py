"""Setup flow. There is nothing to configure — one click and Elmer is in the sidebar.

Deliberately no options flow. Every setting Elmer has lives in its own data,
where the panel writes it and the sensors read it. Mirroring one of them into
the config entry as well would give the same number two homes that could
disagree.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, PANEL_TITLE


class ElmerConfigFlow(ConfigFlow, domain=DOMAIN):
    """One instance, no credentials, no discovery."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=PANEL_TITLE, data={})
