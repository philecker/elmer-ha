"""Photos and PDFs kept on equipment and animals: the manual, the receipt,
the rating plate, the vet's certificate.

The files are the one thing Elmer keeps outside its own JSON, and the one
thing a person sends it that is not text, so most of this module is about
keeping that safe:

* They live in a folder of their own in the config directory — never www,
  which Home Assistant serves to anyone without signing in.
* They are only served to a signed-in user, through a view that requires
  auth. The panel asks Home Assistant to sign each link, so an <img> or a new
  tab can open one without a token, and the signature runs out.
* A file is kept only if its first bytes say it is a JPEG, PNG, WebP or HEIC
  photo or a PDF. Its name and the type the browser claims count for nothing,
  so HTML or SVG — the two that could carry script into Home Assistant's own
  address — cannot be smuggled in as a picture.
* On disk a file is named only by an id Elmer made up, never by anything the
  uploader typed, so there is no path to trick.
* Files nothing refers to any more — the equipment was deleted, the
  attachment removed, a backup imported over the top — are cleared away.
  Only files Elmer has seen a record point at, though: if Elmer starts
  without its data, the files it cannot account for are left alone, and
  importing an export brings them back.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import time
from typing import Any

from aiohttp import web
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from .const import DOMAIN
from .store import ATTACHMENT_ID, INLINE, MAX_NAME, MAX_PER_RECORD, TYPES, clean_attachments

_LOGGER = logging.getLogger(__name__)

MAX_BYTES = 20 * 1024 * 1024
UPLOAD_URL = "/api/elmer/attachments"
FILE_URL = "/api/elmer/attachments/{record_id}/{attachment_id}"

RECORD_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# A file younger than this is never cleared away, even with nothing pointing
# at it yet: an upload writes the file first and the record a moment later.
_GRACE_SECONDS = 600
_KNOWN = "_attachments_known"
_SWEEP_DELAY = 30


def folder(hass: HomeAssistant) -> str:
    """Where the files live: config/elmer/attachments."""
    return hass.config.path("elmer", "attachments")


def sniff(head: bytes) -> str | None:
    """The type a file's first bytes show it to be, if it is one Elmer keeps."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    # HEIC is an ISO media file: a box size, then "ftyp", then its brand.
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1", b"hevc"):
        return "image/heic"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def _filename(name: str, ext: str) -> str:
    """A download name that is plain ASCII, whatever the attachment is called."""
    base = re.sub(r"[^A-Za-z0-9 ._-]+", "", name).strip(" .") or "attachment"
    return f"{base[:80]}.{ext}"


def _store(hass: HomeAssistant):
    for key, value in (hass.data.get(DOMAIN) or {}).items():
        if not key.startswith("_"):
            return value
    return None


def _error(status: int, message: str) -> web.Response:
    return web.json_response({"message": message}, status=status)


class AttachmentUploadView(HomeAssistantView):
    """POST a file (multipart: record, name, file) onto equipment or an animal.

    Anyone signed in may add one, as anyone who can open the panel can edit
    the equipment it belongs to. What they may add is held tightly instead.
    """

    url = UPLOAD_URL
    name = "api:elmer:attachments"
    requires_auth = True

    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        store = _store(hass)
        if store is None:
            return _error(503, "Elmer is not set up.")
        try:
            reader = await request.multipart()
        except (AssertionError, ValueError):
            return _error(400, "Send the file as a form upload.")

        record_id = ""
        name = ""
        data = bytearray()
        got_file = False
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "record":
                record_id = (await part.text())[:64]
            elif part.name == "name":
                name = (await part.text())[: MAX_NAME * 4]
            elif part.name == "file" and not got_file:
                got_file = True
                while chunk := await part.read_chunk(256 * 1024):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        return _error(413, "That file is over 20 MB.")
        if not got_file or not data:
            return _error(400, "There was no file in the upload.")
        if not RECORD_ID.fullmatch(record_id):
            return _error(400, "Which equipment or animal is this for?")

        kind = sniff(bytes(data[:32]))
        if kind is None:
            return _error(415, "Elmer keeps photos (JPEG, PNG, WebP, HEIC) and PDFs.")
        record = store.equipment(record_id)
        if record is None:
            return _error(404, "That equipment or animal no longer exists.")
        existing = clean_attachments(record.get("attachments"))
        if len(existing) >= MAX_PER_RECORD:
            return _error(409, f"There are already {MAX_PER_RECORD} attachments here.")

        att_id = secrets.token_hex(10)
        ext = TYPES[kind]
        target = os.path.join(folder(hass), f"{att_id}.{ext}")

        # Known before it exists, so if the record is never updated (Home
        # Assistant stops mid-upload) the sweep may still clear the file.
        hass.data.setdefault(DOMAIN, {}).setdefault(_KNOWN, set()).add(os.path.basename(target))

        def write() -> None:
            os.makedirs(folder(hass), exist_ok=True)
            partial = target + ".part"
            with open(partial, "wb") as fh:
                fh.write(data)
            os.replace(partial, target)

        await hass.async_add_executor_job(write)
        meta = {
            "id": att_id,
            "name": " ".join(name.split())[:MAX_NAME] or ("Photo" if kind in INLINE else "Document"),
            "type": kind,
            "size": len(data),
            "addedAt": int(time.time() * 1000),
        }
        # Read again rather than reusing `existing`: another upload may have
        # finished while this one was being written.
        current = clean_attachments((store.equipment(record_id) or {}).get("attachments"))
        await store.async_apply([("equipment.put", {"id": record_id, "attachments": current + [meta]})])
        return web.json_response(meta)


class AttachmentFileView(HomeAssistantView):
    """GET one attachment, for a signed-in user or a link Home Assistant signed."""

    url = FILE_URL
    name = "api:elmer:attachment"
    requires_auth = True

    async def get(self, request: web.Request, record_id: str, attachment_id: str) -> web.StreamResponse:
        hass: HomeAssistant = request.app[KEY_HASS]
        store = _store(hass)
        if store is None or not RECORD_ID.fullmatch(record_id) or not ATTACHMENT_ID.fullmatch(attachment_id):
            return _error(404, "Not found.")
        record = store.equipment(record_id) or {}
        meta = next((a for a in clean_attachments(record.get("attachments")) if a["id"] == attachment_id), None)
        if meta is None:
            return _error(404, "Not found.")
        ext = TYPES[meta["type"]]
        path = os.path.join(folder(hass), f"{attachment_id}.{ext}")
        if not await hass.async_add_executor_job(os.path.isfile, path):
            return _error(404, "The file is missing. It may have come from a backup made elsewhere.")
        disposition = "inline" if meta["type"] in INLINE else "attachment"
        return web.FileResponse(
            path,
            headers={
                "Content-Type": meta["type"],
                "Content-Disposition": f'{disposition}; filename="{_filename(meta["name"], ext)}"',
                # Never guess a type from the contents, and if a file is ever
                # opened as a page, give it nothing to run and nothing to reach.
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
                "Cache-Control": "private, max-age=86400",
            },
        )


def referenced(data: dict) -> set[str]:
    """The file names the records point at."""
    names: set[str] = set()
    for record in data.get("equipment") or []:
        for att in clean_attachments(record.get("attachments")):
            names.add(f"{att['id']}.{TYPES[att['type']]}")
    return names


def sweep(path: str, keep: set[str], known: set[str], now: float | None = None) -> list[str]:
    """Delete files nothing points at any more, and uploads that never finished.

    A file goes only if it is one Elmer knows a record pointed at (`known`)
    and none does now (`keep`). One Elmer cannot account for — its data lost,
    a restore that left `.storage/elmer` out — is kept, since deleting it
    could not be undone. Only names Elmer could have written are touched, so
    anything someone puts in the folder by hand is left alone, and nothing
    young enough to be mid-upload is touched at all.
    """
    now = time.time() if now is None else now
    removed: list[str] = []
    try:
        entries = os.listdir(path)
    except FileNotFoundError:
        return removed
    pattern = re.compile(r"^[a-f0-9]{20}\.(jpg|png|webp|heic|pdf)(\.part)?$")
    for entry in entries:
        if not pattern.fullmatch(entry) or entry in keep:
            continue
        if not entry.endswith(".part") and entry not in known:
            continue
        full = os.path.join(path, entry)
        try:
            if now - os.path.getmtime(full) < _GRACE_SECONDS:
                continue
            os.remove(full)
            removed.append(entry)
        except OSError:
            continue
    return removed


@callback
def async_setup_attachments(hass: HomeAssistant, store) -> callable:
    """Register the views once, and sweep the folder after changes."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if not domain_data.get("_attachments_views"):
        hass.http.register_view(AttachmentUploadView())
        hass.http.register_view(AttachmentFileView())
        domain_data["_attachments_views"] = True

    # Every file a record has pointed at since Home Assistant started, plus
    # every file an upload has written. Only these may be swept.
    known: set[str] = domain_data.setdefault(_KNOWN, set())
    pending: list[Any] = []

    async def run(_now: Any = None) -> None:
        pending.clear()
        keep = referenced(store.data)
        known.update(keep)
        removed = await hass.async_add_executor_job(sweep, folder(hass), keep, set(known))
        known.difference_update(removed)
        if removed:
            _LOGGER.debug("cleared %d attachment file(s) nothing refers to", len(removed))

    @callback
    def changed() -> None:
        # Noted on every change, before the sweep, so an attachment added and
        # removed within one burst is still known to be Elmer's to clear.
        known.update(referenced(store.data))
        # One sweep shortly after a burst of changes, not one per change.
        if not pending:
            pending.append(async_call_later(hass, _SWEEP_DELAY, run))

    remove = store.add_listener(changed)
    changed()

    def stop() -> None:
        remove()
        for cancel in pending:
            cancel()
        pending.clear()

    return stop
