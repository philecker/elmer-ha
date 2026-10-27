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

# Mirrors STATUS_RANK in the renderer's model.js. Snoozed sits below on-track
# and above paused: a snooze that left the thing at the top of the list would
# have done nothing, and a snooze is still more temporary than a pause.
STATUS_RANK = {
    "overdue": 0,
    "due": 1,
    "new": 2,
    "ok": 3,
    "snoozed": 4,
    "done": 5,
    "paused": 6,
}

# The four ways a routine can be due. Which one is live used to be inferred
# from the data — months on the record meant seasonal — which worked while
# there were two and stops working at four: a routine can hold a date and an
# interval and a set of months at once, and inferring would make switching
# between them lose whichever lost the precedence. The kind is stored, and
# everything else is kept, so switching back finds the old answer still there.
SCHEDULE_KINDS = ("interval", "months", "clocks", "date")

# Clock changes, under United States rules: forward on the second Sunday in
# March, back on the first Sunday in November. Hardcoded rather than read from
# the configured time zone, which is wrong by a week or two in Europe and
# wrong altogether where there is no clock change. The label says daylight
# saving, so anyone it does not fit has the specific-date option instead.
CLOCKS = ("spring", "fall")


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


def nth_sunday(year: int, month: int, n: int) -> date:
    """The nth Sunday of a month, counting from one.

    ``date.weekday()`` is Monday 0 through Sunday 6 while the reference's
    ``getDay()`` is Sunday 0 through Saturday 6. Both reduce to the same
    offset from the first of the month, which is all either one is used for.
    """
    first = date(year, month, 1)
    offset = (6 - first.weekday()) % 7
    return date(year, month, 1 + offset + 7 * (n - 1))


def clock_change(year: int, which: str) -> date:
    """When the clocks go forward or back in a given year."""
    if which == "spring":
        return nth_sunday(year, 3, 2)
    return nth_sunday(year, 11, 1)


def next_clock(clocks: Any, after: Any, inclusive: bool = False) -> str | None:
    """The next clock change among those chosen, after a date.

    Both changes can be chosen at once — smoke alarm batteries being the job
    everyone is told to do twice a year — so this is the earliest of the
    candidates rather than the next one in the list.
    """
    d = parse_day(after)
    if d is None or not clocks:
        return None
    best: date | None = None
    for year in (d.year, d.year + 1):
        for which in clocks:
            if which not in CLOCKS:
                continue
            candidate = clock_change(year, which)
            if candidate > d or (inclusive and candidate == d):
                if best is None or candidate < best:
                    best = candidate
    return to_day(best) if best is not None else None


def _anniversary(year: int, base: date) -> date:
    """The same day of the year, in another year.

    29 February rolls to 1 March rather than clamping to the 28th, which is
    what the year arithmetic in ``add_interval`` already does. Two rules for
    the same question would be worse than one slightly surprising one.
    """
    if base.month == 2 and base.day == 29 and not calendar.isleap(year):
        return date(year, 3, 1)
    return date(year, base.month, base.day)


def next_anniversary(on_date: Any, after: Any, inclusive: bool = False) -> str | None:
    """The next time a specific date comes round again, after a date."""
    base = parse_day(on_date)
    d = parse_day(after)
    if base is None or d is None:
        return None
    for year in (d.year, d.year + 1):
        candidate = _anniversary(year, base)
        if candidate > d or (inclusive and candidate == d):
            return to_day(candidate)
    return None


def yearly(task: dict) -> bool:
    """Whether a specific-date routine comes back every year.

    Absent in a hand-edited file means yearly, because a routine that keeps
    coming back is the safer thing to assume: the other reading would quietly
    retire something the moment it was first done.
    """
    if not task:
        return True
    return bool(task.get("onDateYearly", True))


def schedule_kind(task: dict) -> str:
    """Which of the four kinds a routine is on.

    Files written before there were four say nothing, and months on the
    record are what made a routine seasonal then, so that is what they mean
    now. Everything else was an interval.
    """
    kind = (task or {}).get("schedule")
    if kind in SCHEDULE_KINDS:
        return kind
    return "months" if (task or {}).get("months") else "interval"


def finished(task: dict) -> bool:
    """A one-off that has been done. There is no next time, and that is the point."""
    return (
        bool(task)
        and schedule_kind(task) == "date"
        and not yearly(task)
        and bool(task.get("lastDone"))
    )


def next_seasonal(months: Any, last_done: Any, inclusive: bool = False) -> str | None:
    """The first of the next chosen month, strictly after ``last_done``.

    A month-anchored routine does not drift. An interval walks forward from
    whenever you happened to do it, so winterizing in late November one year
    moves it later every year after; this lands on the same month regardless.

    The first of the month is the due date rather than any particular day,
    because the month is the whole of what was asked for. The warn-ahead
    setting is what gives the lead time to act on it.

    ``months`` arrives sorted and within 1-12 from the store, so the first
    candidate found scanning this year and then the next is the right one.
    """
    d = parse_day(last_done)
    if d is None or not months:
        return None
    for year in (d.year, d.year + 1):
        for month in months:
            candidate = date(year, int(month), 1)
            if candidate > d or (inclusive and candidate == d):
                return to_day(candidate)
    return None


def next_due(task: dict) -> str | None:
    """When a routine is next due, or None if there is nothing to go on.

    Three of the four kinds know their own dates and need no last-done to
    have one: a routine anchored to November is due in November whether or
    not anybody has ever done it. Only an interval has nothing to count
    from, and a routine you have never done is one that wants doing, so it
    is due now.

    Done once, the next occurrence is the first strictly after that date —
    otherwise marking something done would leave it due the same day. Never
    done, today itself counts, or a routine anchored to today would read as
    due next year.
    """
    if not task:
        return None
    kind = schedule_kind(task)
    last = task.get("lastDone")

    if kind == "interval":
        if not last:
            return today()
        return add_interval(last, task.get("intervalCount"), task.get("intervalUnit"))

    anchor = last or today()
    inclusive = not last

    if kind == "months":
        return next_seasonal(task.get("months"), anchor, inclusive)
    if kind == "clocks":
        return next_clock(task.get("clocks"), anchor, inclusive)

    # A specific date, either every year or exactly once.
    if yearly(task):
        return next_anniversary(task.get("onDate"), anchor, inclusive)
    if last:
        return None
    once = parse_day(task.get("onDate"))
    return to_day(once) if once else None


def task_state(task: dict, due_soon_days: int = DUE_SOON_DAYS) -> dict:
    """Due date, days left, status and cycle progress for one routine.

    ``status`` is one of ``new`` (never completed, so nothing is scheduled),
    ``overdue``, ``due`` (within ``due_soon_days``), ``ok``, or ``paused``.

    Paused short-circuits everything else, and ``daysLeft`` comes back None
    with it. That is the whole point rather than a convenience: days-left is
    what a routine's own sensor reports and what a ``numeric_state`` condition
    compares, so a paused routine whose number kept counting down would go on
    firing the automation it was paused to silence. None reaches Home
    Assistant as ``unknown``, which no numeric condition matches. The same
    None takes it out of the counts, out of the next-due sensor and out of
    the parts a routine needs, all of which already skip it.

    The date it would have been due is still returned, because the panel has
    to be able to say what was paused rather than just that something was.
    """
    if task and task.get("paused"):
        return {
            "due": next_due(task),
            "daysLeft": None,
            "status": "paused",
            "progress": 0,
            "cycle": None,
        }

    # Snoozed until a date, then back to whatever it really is. Pausing says
    # stop tracking this; snoozing says not now, and undoes itself.
    #
    # daysLeft goes None for the same reason it does when paused: it is what
    # the routine's own sensor reports, and an automation that went on firing
    # about the thing you had just set aside would make the snooze a panel
    # decoration rather than a decision. The real due date is still returned,
    # so the panel can say what is being put off and for how long.
    #
    # Nothing is cleared when the day arrives. A date in the past simply
    # stops matching here, which means waking up needs no timer, no service
    # and no write — the routine is awake the moment the date rolls over.
    if task and task.get("snoozedUntil") and today() < task["snoozedUntil"]:
        return {
            "due": next_due(task),
            "daysLeft": None,
            "status": "snoozed",
            "progress": 0,
            "cycle": None,
            "snoozedUntil": task["snoozedUntil"],
        }

    due = next_due(task)
    if due is None:
        # Two different nothings. A one-off that has been done is over, and
        # says so; anything else here has a kind chosen with nothing filled
        # in — months with no months ticked — and is genuinely unscheduled.
        over = finished(task)
        return {
            "due": None,
            "daysLeft": None,
            "status": "done" if over else "new",
            "progress": 1 if over else 0,
            "cycle": None,
        }
    now = today()
    days_left = days_between(now, due)
    if task.get("lastDone"):
        cycle = max(1, days_between(task["lastDone"], due))
        elapsed = days_between(task["lastDone"], now)
        progress = max(0.0, min(1.0, elapsed / cycle))
    else:
        # Never done, so there is no cycle to be part-way through. The ring
        # stays empty until the day arrives rather than inventing a start
        # date to measure from.
        cycle = None
        progress = 1.0 if days_left <= 0 else 0.0
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


def overdue_notice(rows: list[dict], limit: int = 5) -> tuple[str, str] | None:
    """The title and body of the overdue notification, or None for nothing.

    Pure on purpose. The Home Assistant half of this is three lines of create
    and dismiss; the part worth testing is what it says, and keeping the
    wording here means it can be checked without a Home Assistant running.

    Rows come in already sorted by urgency, so the first few are the most
    overdue. Paused routines never reach here — they are not overdue, they
    are set aside — which is the whole arrangement working as one piece.
    """
    late = [r for r in rows if r["state"]["status"] == "overdue"]
    if not late:
        return None

    def line(row: dict) -> str:
        name = (row["task"].get("name") or "").strip() or "Something"
        eq = row.get("equipment") or {}
        where = (eq.get("name") or "").strip()
        days = row["state"]["daysLeft"]
        ago = "today" if days == 0 else f"{abs(days)} day{'' if abs(days) == 1 else 's'} ago"
        return f"- {name}{f' ({where})' if where else ''} — due {ago}"

    n = len(late)
    title = f"{n} overdue" if n > 1 else "1 overdue"
    body = [line(r) for r in late[:limit]]
    if n > limit:
        body.append(f"...and {n - limit} more")
    return title, "\n".join(body)


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
