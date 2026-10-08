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

function nextDue(task) {
  if (!task || !task.lastDone) return null;
  return addInterval(task.lastDone, task.intervalCount, task.intervalUnit);
}

function taskState(task, dueSoonDays = 14) {
  const due = nextDue(task);
  if (!due) return { due: null, daysLeft: null, status: 'new', progress: 0 };
  const now = today();
  const daysLeft = daysBetween(now, due);
  const cycle = Math.max(1, daysBetween(task.lastDone, due));
  const elapsed = daysBetween(task.lastDone, now);
  const progress = Math.max(0, Math.min(1, elapsed / cycle));
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
  nextDue,
  taskState,
  overdueTasks,
};
