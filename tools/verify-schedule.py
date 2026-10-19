#!/usr/bin/env python3
"""Prove schedule.py and schedule.cjs agree.

Generates a large grid of inputs, runs them through Node and through Python,
and reports the first few divergences. Exits non-zero if any are found.

    python3 tools/verify-schedule.py [path/to/schedule.cjs]
"""

from __future__ import annotations

import calendar
import json
import os
import subprocess
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "custom_components", "elmer"))

import schedule as py  # noqa: E402

# The reference implementation the Python port is held to. It lives in the
# repository so the parity check runs from a plain checkout and in CI, rather
# than only where a copy happens to be lying around.
DEFAULT_CJS = os.path.join(HERE, "reference", "schedule.cjs")

UNITS = ["days", "weeks", "months", "years", "", "fortnights"]


def build_cases():
    """Dates chosen to land on every edge the month and year math has."""
    cases = []
    seeds = []

    # Month ends, leap days, year boundaries, and a plain mid-month date.
    for y in (2023, 2024, 2025, 2026, 2027, 2028):
        for m in range(1, 13):
            last = calendar.monthrange(y, m)[1]
            for d in (1, 15, 28, 29, 30, 31):
                if d <= last:
                    seeds.append(date(y, m, d).isoformat())
    # Deduplicate while keeping order stable so a failure is reproducible.
    seeds = list(dict.fromkeys(seeds))

    counts = [0, 1, 2, 3, 6, 7, 11, 12, 13, 18, 24, 25, 36, -1, -6, -12, -13]
    for iso in seeds:
        for unit in UNITS:
            for n in counts:
                cases.append({"iso": iso, "count": n, "unit": unit})

    # A few shapes the data file can legitimately contain.
    for bad in [None, "", "nope", "2026-00-10", "2026-3", "2026-03-00", 12345]:
        for unit in ("months", "days"):
            cases.append({"iso": bad, "count": 3, "unit": unit})

    # Non-integer and non-numeric counts, which Number() coerces in JS.
    for weird in ["3", "0", None, "", "abc", 2.0]:
        cases.append({"iso": "2026-01-31", "count": weird, "unit": "months"})

    return cases


def build_spans(cases):
    spans = []
    isos = [c["iso"] for c in cases if isinstance(c["iso"], str)][:400]
    for a in isos[::7]:
        for b in isos[::11]:
            spans.append({"a": a, "b": b})
    return spans


def build_tasks():
    """task_state exercised against a fixed 'today' so the run is repeatable."""
    tasks = []
    for last in [
        "2024-02-29",
        "2025-01-31",
        "2026-03-14",
        "2026-09-30",
        "2026-10-07",
        "2026-12-31",
        "2027-06-01",
        None,
        "",
    ]:
        for count, unit in [
            (3, "months"),
            (1, "years"),
            (14, "days"),
            (2, "weeks"),
            (6, "months"),
            (0, "months"),
            (-1, "months"),
        ]:
            tasks.append(
                {
                    "id": f"t{len(tasks)}",
                    "name": "x",
                    "lastDone": last,
                    "intervalCount": count,
                    "intervalUnit": unit,
                }
            )
    # Seasonal routines, which ignore the interval entirely and land on the
    # first of a chosen month. Every shape that matters: one month, two, a
    # month either side of the last-done date, a December anchor that has to
    # roll into next year, and all twelve.
    for last in [
        "2024-02-29",
        "2025-12-31",
        "2026-01-01",
        "2026-06-15",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
        "2026-12-01",
        None,
        "",
    ]:
        for months in [
            [1],
            [10],
            [12],
            [4, 10],
            [3, 6, 9, 12],
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            [6],
            [2],
        ]:
            tasks.append(
                {
                    "id": f"s{len(tasks)}",
                    "name": "x",
                    "lastDone": last,
                    # Carried alongside on purpose: months win, and a routine
                    # that still remembers its old interval must not use it.
                    "intervalCount": 3,
                    "intervalUnit": "months",
                    "months": months,
                }
            )

    # Snoozed, around the fixed today of 2026-10-07: a date well ahead, the
    # day itself, the day before and after, and one long past. The boundary
    # is the whole of it — a snooze that ends today has ended, and an
    # off-by-one there is a day of being told about something you set aside.
    for until in [
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "2026-11-01",
        "2027-01-01",
        "2020-01-01",
        None,
        "",
        "not-a-date",
    ]:
        for last, count, unit in [
            ("2026-09-01", 1, "months"),
            ("2026-10-06", 3, "months"),
            ("2025-01-01", 1, "years"),
            (None, 3, "months"),
        ]:
            tasks.append(
                {
                    "id": f"z{len(tasks)}",
                    "name": "x",
                    "lastDone": last,
                    "intervalCount": count,
                    "intervalUnit": unit,
                    "snoozedUntil": until,
                }
            )
    # And one seasonal routine asleep, since the two short-circuits sit next
    # to each other and the order they are tested in matters.
    tasks.append({
        "id": "zs", "name": "x", "lastDone": "2026-09-20", "months": [10],
        "intervalCount": 3, "intervalUnit": "months", "snoozedUntil": "2026-12-01",
    })

    # The same routines again, paused. Pausing is a short-circuit in both
    # implementations, and a short-circuit is exactly the kind of thing that
    # gets added to one and forgotten in the other. It also pins the order:
    # paused wins over asleep, and these carry both.
    tasks += [dict(t, id=f"{t['id']}p", paused=True) for t in list(tasks)]
    return tasks


NODE_SCRIPT = r"""
const s = require(process.argv[2]);
const payload = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const FIXED_TODAY = payload.today;

const out = {
  addInterval: payload.cases.map((c) => s.addInterval(c.iso, c.count, c.unit)),
  daysBetween: payload.spans.map((p) => s.daysBetween(p.a, p.b)),
  parseDay: payload.cases.map((c) => {
    const d = s.parseDay(c.iso);
    return d ? s.toDay(d) : null;
  }),
  // taskState reads today() internally, so pin it for the comparison.
  taskState: (() => {
    const realDate = Date;
    const [y, m, d] = FIXED_TODAY.split('-').map(Number);
    // eslint-disable-next-line no-global-assign
    Date = class extends realDate {
      constructor(...args) {
        if (args.length === 0) super(y, m - 1, d, 12, 0, 0, 0);
        else super(...args);
      }
    };
    Date.now = realDate.now;
    const rows = payload.tasks.map((t) => {
      const st = s.taskState(t, payload.dueSoonDays);
      return {
        due: st.due,
        daysLeft: st.daysLeft,
        status: st.status,
        // Only set while asleep, so undefined has to become null on both
        // sides or the comparison would differ on a field neither has.
        snoozedUntil: st.snoozedUntil === undefined ? null : st.snoozedUntil,
        // Round so float formatting can never be the thing that differs.
        progress: Math.round(st.progress * 1e9) / 1e9,
        cycle: st.cycle === undefined ? null : st.cycle,
      };
    });
    // eslint-disable-next-line no-global-assign
    Date = realDate;
    return rows;
  })(),
};
process.stdout.write(JSON.stringify(out));
"""


def main() -> int:
    cjs = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CJS)
    if not os.path.exists(cjs):
        print(f"cannot find schedule.cjs at {cjs}", file=sys.stderr)
        print("pass its path as the first argument", file=sys.stderr)
        return 2

    cases = build_cases()
    spans = build_spans(cases)
    tasks = build_tasks()
    fixed_today = "2026-10-07"
    due_soon = 14

    payload = {
        "cases": cases,
        "spans": spans,
        "tasks": tasks,
        "today": fixed_today,
        "dueSoonDays": due_soon,
    }

    with tempfile.TemporaryDirectory() as tmp:
        payload_path = os.path.join(tmp, "payload.json")
        script_path = os.path.join(tmp, "run.cjs")
        with open(payload_path, "w") as fh:
            json.dump(payload, fh)
        with open(script_path, "w") as fh:
            fh.write(NODE_SCRIPT)
        proc = subprocess.run(
            ["node", script_path, cjs, payload_path],
            capture_output=True,
            text=True,
        )
    if proc.returncode != 0:
        print("node failed:\n" + proc.stderr, file=sys.stderr)
        return 2
    js = json.loads(proc.stdout)

    # Pin Python's today() the same way.
    py.today = lambda: fixed_today  # type: ignore[assignment]

    failures = []

    def check(label, got, want, detail):
        if got != want:
            failures.append((label, detail, got, want))

    for c, want in zip(cases, js["addInterval"]):
        check(
            "addInterval",
            py.add_interval(c["iso"], c["count"], c["unit"]),
            want,
            f"{c['iso']!r} + {c['count']} {c['unit']!r}",
        )

    for c, want in zip(cases, js["parseDay"]):
        d = py.parse_day(c["iso"])
        check("parseDay", py.to_day(d) if d else None, want, repr(c["iso"]))

    for p, want in zip(spans, js["daysBetween"]):
        check(
            "daysBetween",
            py.days_between(p["a"], p["b"]),
            want,
            f"{p['a']} -> {p['b']}",
        )

    for t, want in zip(tasks, js["taskState"]):
        got = py.task_state(t, due_soon)
        got = {
            "due": got["due"],
            "daysLeft": got["daysLeft"],
            "status": got["status"],
            "progress": round(got["progress"], 9),
            "cycle": got["cycle"],
            "snoozedUntil": got.get("snoozedUntil"),
        }
        check(
            "taskState",
            got,
            want,
            f"lastDone={t['lastDone']!r} every {t['intervalCount']} {t['intervalUnit']}"
            + (f" months={t['months']}" if t.get("months") else "")
            + (f" asleep until {t['snoozedUntil']!r}" if t.get("snoozedUntil") else ""),
        )

    total = len(cases) * 2 + len(spans) + len(tasks)
    if failures:
        print(f"FAIL — {len(failures)} of {total} comparisons diverged\n")
        for label, detail, got, want in failures[:25]:
            print(f"  {label}: {detail}")
            print(f"    python {got!r}")
            print(f"    node   {want!r}")
        if len(failures) > 25:
            print(f"  ... and {len(failures) - 25} more")
        return 1

    print(f"PASS — {total} comparisons, no divergence")
    print(f"  addInterval  {len(cases)} cases over {len(UNITS)} units")
    print(f"  parseDay     {len(cases)} cases")
    print(f"  daysBetween  {len(spans)} spans")
    print(f"  taskState    {len(tasks)} routines at a fixed today={fixed_today}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
