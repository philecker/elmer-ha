"""Shared names."""

DOMAIN = "elmer"

# Bumped only when the stored shape changes in a way that needs migrating.
STORAGE_VERSION = 1
STORAGE_KEY = "elmer"

PANEL_URL = "elmer"
PANEL_TITLE = "Elmer"
PANEL_ICON = "mdi:toolbox-outline"
# Served from /elmer_frontend/..., versioned so a browser never holds a stale
# panel after an update.
FRONTEND_URL = "/elmer_frontend"
PANEL_COMPONENT = "elmer-panel"

SIGNAL_UPDATED = "elmer_updated"

DEFAULT_DUE_SOON_DAYS = 14

CATEGORIES = {
    "hvac": "Heating & Cooling",
    "water": "Water",
    "appliance": "Appliance",
    "safety": "Safety",
    "exterior": "Exterior",
    "vehicle": "Vehicle",
    "other": "Other",
}

SERVICE_COMPLETE = "complete"
SERVICE_UNDO = "undo"
SERVICE_ADJUST_STOCK = "adjust_stock"
SERVICE_IMPORT = "import_json"
SERVICE_EXPORT = "export_json"
