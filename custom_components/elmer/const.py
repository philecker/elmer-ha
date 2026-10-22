"""Shared names."""

DOMAIN = "elmer"

# Bumped only when the stored shape changes in a way that needs migrating.
STORAGE_VERSION = 1
STORAGE_KEY = "elmer"

PANEL_URL = "elmer"
PANEL_TITLE = "Elmer"
# Elmer's own mark, not an MDI lookalike, so the sidebar and the panel header
# are the same drawing. The set it names is registered by sidebar-icon.js.
PANEL_ICON = "elmer:toolbox"
# Loaded on every Home Assistant page, because the sidebar is drawn long
# before anybody opens the panel.
SIDEBAR_ICON_FILE = "sidebar-icon.js"
# Served from /elmer_frontend/<version>/..., so a browser never holds a stale
# panel after an update. The sidebar icon above is the exception and sits
# directly under this prefix, unversioned; __init__.py says why.
FRONTEND_URL = "/elmer_frontend"
PANEL_COMPONENT = "elmer-panel"

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
