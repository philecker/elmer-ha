'use strict';

// The one source of truth for when something is due. The renderer bundles this
// through esbuild; the main process requires it directly, so the notification
// that fires in the background and the row you see in the window can never
// disagree about a date.

function parseDay(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function toDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function today() {
  return toDay(new Date());
}

function addInterval(iso, count, unit) {
  const d = parseDay(iso);
  if (!d) return null;
  const n = Number(count) || 0;
  if (unit === 'days') d.setDate(d.getDate() + n);
  else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  else {
    // Month math clamps to the end of shorter months: Jan 31 + 1 month = Feb 28.
    const targetDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(targetDay, lastOfMonth));
  }
  return toDay(d);
}

function daysBetween(fromIso, toIso) {
  const a = parseDay(fromIso);
  const b = parseDay(toIso);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * The first of the next chosen month, strictly after lastDone.
 *
 * A month-anchored routine does not drift the way an interval does. months
 * arrives sorted and within 1-12, so the first candidate found scanning this
 * year and then the next is the right one.
 */
function nextSeasonal(months, lastDone, inclusive = false) {
  const d = parseDay(lastDone);
  if (!d || !months || !months.length) return null;
  for (const year of [d.getFullYear(), d.getFullYear() + 1]) {
    for (const month of months) {
      const candidate = new Date(year, Number(month) - 1, 1, 12, 0, 0, 0);
      if (candidate > d || (inclusive && candidate.getTime() === d.getTime())) {
        return toDay(candidate);
      }
    }
  }
  return null;
}

// The four ways a routine can be due. Which one is live is stored rather than
// inferred: a routine can hold a date and an interval and a set of months at
// once, and inferring would lose whichever lost the precedence.
const SCHEDULE_KINDS = ['interval', 'months', 'clocks', 'date'];

// United States rules: forward on the second Sunday in March, back on the
// first Sunday in November.
const CLOCKS = ['spring', 'fall'];

/** The nth Sunday of a month, counting from one. */
function nthSunday(year, month, n) {
  const first = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const offset = (7 - first.getDay()) % 7;
  return new Date(year, month - 1, 1 + offset + 7 * (n - 1), 12, 0, 0, 0);
}

function clockChange(year, which) {
  return which === 'spring' ? nthSunday(year, 3, 2) : nthSunday(year, 11, 1);
}

/** The earliest of the chosen clock changes after a date. */
function nextClock(clocks, after, inclusive = false) {
  const d = parseDay(after);
  if (!d || !clocks || !clocks.length) return null;
  let best = null;
  for (const year of [d.getFullYear(), d.getFullYear() + 1]) {
    for (const which of clocks) {
      if (!CLOCKS.includes(which)) continue;
      const candidate = clockChange(year, which);
      if (candidate > d || (inclusive && candidate.getTime() === d.getTime())) {
        if (!best || candidate < best) best = candidate;
      }
    }
  }
  return best ? toDay(best) : null;
}

/** The same day of the year in another year; 29 Feb rolls to 1 March. */
function anniversary(year, base) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (base.getMonth() === 1 && base.getDate() === 29 && !leap) {
    return new Date(year, 2, 1, 12, 0, 0, 0);
  }
  return new Date(year, base.getMonth(), base.getDate(), 12, 0, 0, 0);
}

function nextAnniversary(onDate, after, inclusive = false) {
  const base = parseDay(onDate);
  const d = parseDay(after);
  if (!base || !d) return null;
  for (const year of [d.getFullYear(), d.getFullYear() + 1]) {
    const candidate = anniversary(year, base);
    if (candidate > d || (inclusive && candidate.getTime() === d.getTime())) {
      return toDay(candidate);
    }
  }
  return null;
}

/** Absent means yearly: the reading that does not quietly retire a routine. */
function isYearly(task) {
  if (!task) return true;
  return task.onDateYearly === undefined ? true : !!task.onDateYearly;
}

function scheduleKind(task) {
  const kind = task && task.schedule;
  if (SCHEDULE_KINDS.includes(kind)) return kind;
  // Written before there were four kinds: months are what made it seasonal.
  return task && task.months && task.months.length ? 'months' : 'interval';
}

/** A one-off that has been done. There is no next time, and that is the point. */
function finished(task) {
  return !!task && scheduleKind(task) === 'date' && !isYearly(task) && !!task.lastDone;
}

/**
 * When a routine is next due, or null if there is nothing to go on.
 *
 * Three of the four kinds know their own dates and need no last-done. Only an
 * interval has nothing to count from, and a routine never done is one that
 * wants doing, so it is due now. Done once, the next occurrence is the first
 * strictly after that date; never done, today itself counts.
 */
function nextDue(task) {
  if (!task) return null;
  const kind = scheduleKind(task);
  const last = task.lastDone;

  if (kind === 'interval') {
    if (!last) return today();
    return addInterval(last, task.intervalCount, task.intervalUnit);
  }

  const anchor = last || today();
  const inclusive = !last;

  if (kind === 'months') return nextSeasonal(task.months, anchor, inclusive);
  if (kind === 'clocks') return nextClock(task.clocks, anchor, inclusive);

  if (isYearly(task)) return nextAnniversary(task.onDate, anchor, inclusive);
  if (last) return null;
  const once = parseDay(task.onDate);
  return once ? toDay(once) : null;
}

function taskState(task, dueSoonDays = 14) {
  // Paused short-circuits the rest, and daysLeft comes back null with it:
  // that null is what reaches Home Assistant as unknown, which no numeric
  // condition matches, so a paused routine stops firing the automation it
  // was paused to silence. The date it would have been due survives.
  if (task && task.paused) {
    return { due: nextDue(task), daysLeft: null, status: 'paused', progress: 0, cycle: null };
  }
  // Snoozed until a date. daysLeft goes null for the same reason pausing does
  // — it is what the sensor reports — and a date in the past simply stops
  // matching, so waking up needs no timer and no write.
  if (task && task.snoozedUntil && today() < task.snoozedUntil) {
    return {
      due: nextDue(task),
      daysLeft: null,
      status: 'snoozed',
      progress: 0,
      cycle: null,
      snoozedUntil: task.snoozedUntil,
    };
  }
  const due = nextDue(task);
  if (!due) {
    // Two different nothings: a one-off that has been done is over, while
    // anything else here has a kind chosen with nothing filled in.
    const over = finished(task);
    return {
      due: null,
      daysLeft: null,
      status: over ? 'done' : 'new',
      progress: over ? 1 : 0,
      cycle: null,
    };
  }
  const now = today();
  const daysLeft = daysBetween(now, due);
  // How near the day is, against the warn-ahead window. It used to be the
  // proportion of the service interval elapsed, which made a six-monthly
  // routine two weeks out read fuller than a monthly one five days out — the
  // ring disagreeing with the number inside it and with the order of the
  // list. It also wants no last-done, so it reads the same whoever has
  // touched the routine.
  const span = Math.max(1, dueSoonDays);
  const progress = Math.max(0, Math.min(1, (span - daysLeft) / span));
  // The service interval, still true and still only knowable once done.
  const cycle = task.lastDone ? Math.max(1, daysBetween(task.lastDone, due)) : null;
  let status = 'ok';
  if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= dueSoonDays) status = 'due';
  return { due, daysLeft, status, progress, cycle };
}

/** Everything past its due date, most overdue first. */
function overdueTasks(data) {
  if (!data || !Array.isArray(data.tasks)) return [];
  const soon = (data.settings && data.settings.dueSoonDays) || 14;
  return data.tasks
    .map((task) => ({ task, state: taskState(task, soon) }))
    .filter((row) => row.state.status === 'overdue')
    .sort((a, b) => a.state.daysLeft - b.state.daysLeft);
}

module.exports = {
  parseDay,
  toDay,
  today,
  addInterval,
  daysBetween,
  nextSeasonal,
  nthSunday,
  clockChange,
  nextClock,
  nextAnniversary,
  scheduleKind,
  finished,
  nextDue,
  taskState,
  overdueTasks,
};
