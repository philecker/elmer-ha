"""When something is due.

Ported from the reference implementation kept at ``tools/reference/schedule.cjs``,
which ``tools/verify-schedule.py`` holds this to across tens of thousands of
inputs. Date arithmetic fails silently — a day's drift is a wrong answer, not a
crash — so the two are compared rather than trusted.

Two of the reference's behaviours are reproduced deliberately rather than
corrected, because a quiet change to when things fall due is worse than an
inelegant rule:

* Month arithmetic clamps to the end of a shorter month, so 31 Jan + 1 month is
  28 Feb (29 Feb in a leap year), not 3 March.
* Year arithmetic does *not* clamp. ``new Date(2024, 1, 29).setFullYear(2025)``
  rolls forward to 1 March, and so does this.

``tools/verify-schedule.py`` runs tens of thousands of inputs through both
implementations and fails on any divergence.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any

DUE_SOON_DAYS = 14

# Mirrors STATUS_RANK in the renderer's model.js.
STATUS_RANK = {"overdue": 0, "due": 1, "new": 2, "ok": 3}


def parse_day(iso: Any) -> date | None:
    """``"2026-03-14"`` to a date, or None for anything unusable.

    Deliberately lenient in the same places the JavaScript is: a missing value,
    a non-string, a malformed string and a zero component all return None
    rather than raising, because this reads whatever is in the data file.
    """
    if not iso:
        return None
    parts = str(iso).split("-")
    if len(parts) < 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except (TypeError, ValueError):
        return None
    # `if (!y || !m || !d) return null` — zero is falsy in JavaScript.
    if not y or not m or not d:
        return None
    try:
        return date(y, m, d)
    except ValueError:
        # JavaScript's Date constructor would roll 2026-02-30 over to 2 March.
        # Nothing writes such a value, so refusing it is the safer divergence;
        # verify-schedule.py excludes impossible dates from its comparison.
        return None


def to_day(value: date) -> str:
    return value.isoformat()


def today() -> str:
    return to_day(date.today())


def add_interval(iso: str, count: Any, unit: str) -> str | None:
    """Advance a date by an interval, matching the JavaScript exactly."""
    d = parse_day(iso)
    if d is None:
        return None
    try:
        n = int(count)
    except (TypeError, ValueError):
        try:
            # `Number("3.7") || 0` then used in setDate truncates toward zero.
            n = int(float(count))
        except (TypeError, ValueError):
            n = 0

    if unit == "days":
        return to_day(d + timedelta(days=n))
    if unit == "weeks":
        return to_day(d + timedelta(days=n * 7))
    if unit == "years":
        # setFullYear does not clamp: 29 Feb + 1 year overflows to 1 March.
        y = d.year + n
        if d.month == 2 and d.day == 29 and not calendar.isleap(y):
            return to_day(date(y, 3, 1))
        return to_day(date(y, d.month, d.day))

    # Everything else is months, including a missing or unknown unit — the
    # JavaScript falls through to the same branch.
    target_day = d.day
    total = (d.year * 12 + (d.month - 1)) + n
    y, m = divmod(total, 12)
    m += 1
    last = calendar.monthrange(y, m)[1]
    return to_day(date(y, m, min(target_day, last)))


def days_between(from_iso: str, to_iso: str) -> int:
    a = parse_day(from_iso)
    b = parse_day(to_iso)
    if a is None or b is None:
        return 0
    return (b - a).days


def next_due(task: dict) -> str | None:
    if not task or not task.get("lastDone"):
        return None
    return add_interval(
        task["lastDone"], task.get("intervalCount"), task.get("intervalUnit")
    )


def task_state(task: dict, due_soon_days: int = DUE_SOON_DAYS) -> dict:
    """Due date, days left, status and cycle progress for one routine.

    ``status`` is one of ``new`` (never completed, so nothing is scheduled),
    ``overdue``, ``due`` (within ``due_soon_days``) or ``ok``.
    """
    due = next_due(task)
    if due is None:
        return {
            "due": None,
            "daysLeft": None,
            "status": "new",
            "progress": 0,
            "cycle": None,
        }
    now = today()
    days_left = days_between(now, due)
    cycle = max(1, days_between(task["lastDone"], due))
    elapsed = days_between(task["lastDone"], now)
    progress = max(0.0, min(1.0, elapsed / cycle))
    if days_left < 0:
        status = "overdue"
    elif days_left <= due_soon_days:
        status = "due"
    else:
        status = "ok"
    return {
        "due": due,
        "daysLeft": days_left,
        "status": status,
        "progress": progress,
        "cycle": cycle,
    }


def overdue_tasks(data: dict) -> list[dict]:
    """Everything past its due date, most overdue first."""
    if not data or not isinstance(data.get("tasks"), list):
        return []
    soon = (data.get("settings") or {}).get("dueSoonDays") or DUE_SOON_DAYS
    rows = [{"task": t, "state": task_state(t, soon)} for t in data["tasks"]]
    rows = [r for r in rows if r["state"]["status"] == "overdue"]
    rows.sort(key=lambda r: r["state"]["daysLeft"])
    return rows


def sort_key(row: dict):
    """Urgency order, matching sortByUrgency in the renderer.

    Overdue first, then due, then never-done, then fine; within a band, the
    nearest date first. A routine with no date sorts to the end of its band.
    """
    state = row["state"]
    days = state.get("daysLeft")
    return (
        STATUS_RANK.get(state["status"], 9),
        0 if days is not None else 1,
        days if days is not None else 0,
    )


def stock_status(supply: dict) -> str:
    """``out`` with none left, ``low`` at or below the reorder point."""
    try:
        qty = float(supply.get("quantity") or 0)
    except (TypeError, ValueError):
        qty = 0
    try:
        floor = float(supply.get("reorderAt") or 0)
    except (TypeError, ValueError):
        floor = 0
    if qty <= 0:
        return "out"
    if qty <= floor:
        return "low"
    return "ok"
