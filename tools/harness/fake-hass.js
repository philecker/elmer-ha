// Stands in for Home Assistant so the real panel can be driven in a browser.
//
// It answers the five websocket commands the integration registers, backed by
// a small in-memory store that mirrors store.py's operations and schedule.py's
// date maths. Those are already covered on the Python side;
// what this exists to exercise is the panel — that a tap reaches the right
// command, that stock and history update, that nothing throws.

import '../../custom_components/elmer/frontend/elmer-panel.js';

/* ------------------------------------------------------- schedule maths -- */

function parseDay(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function toDay(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}
function today() { return toDay(new Date()); }
function addInterval(iso, count, unit) {
  const d = parseDay(iso);
  if (!d) return null;
  const n = Number(count) || 0;
  if (unit === 'days') d.setDate(d.getDate() + n);
  else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
  else if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  else {
    const target = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(target, last));
  }
  return toDay(d);
}
function daysBetween(a, b) {
  const x = parseDay(a); const y = parseDay(b);
  if (!x || !y) return 0;
  return Math.round((y - x) / 86400000);
}
/** Mirrors next_seasonal in schedule.py. */
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

// United States rules, mirroring CLOCKS and clock_change in schedule.py:
// forward on the second Sunday in March, back on the first Sunday in November.
const CLOCKS = ['spring', 'fall'];
function nthSunday(year, month, n) {
  const first = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const offset = (7 - first.getDay()) % 7;
  return new Date(year, month - 1, 1 + offset + 7 * (n - 1), 12, 0, 0, 0);
}
function clockChange(year, which) {
  return which === 'spring' ? nthSunday(year, 3, 2) : nthSunday(year, 11, 1);
}
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
function isYearly(task) {
  if (!task) return true;
  return task.onDateYearly === undefined ? true : !!task.onDateYearly;
}
function scheduleKind(task) {
  const kind = task && task.schedule;
  if (['interval', 'months', 'clocks', 'date'].includes(kind)) return kind;
  return task && task.months && task.months.length ? 'months' : 'interval';
}
function finished(task) {
  return !!task && scheduleKind(task) === 'date' && !isYearly(task) && !!task.lastDone;
}

/** Mirrors next_due in schedule.py. */
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

function taskState(task, soon = 14) {
  // Mirrors the short-circuit in schedule.py: paused wins over everything and
  // takes daysLeft with it. The harness computes this itself, so a change to
  // the real one that is not made here shows up as the panel behaving
  // correctly against a store that disagrees with the shipped one.
  if (task && task.paused) {
    return { due: nextDue(task), daysLeft: null, status: 'paused', progress: 0, cycle: null };
  }
  // Mirrors the snooze short-circuit in schedule.py.
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
  // Mirrors schedule.py: how near the day is, against the warn-ahead window.
  const span = Math.max(1, soon);
  const progress = Math.max(0, Math.min(1, (span - daysLeft) / span));
  const cycle = task.lastDone ? Math.max(1, daysBetween(task.lastDone, due)) : null;
  let status = 'ok';
  if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= soon) status = 'due';
  return { due, daysLeft, status, progress, cycle };
}
function stockStatus(s) {
  const q = Number(s.quantity) || 0;
  const f = Number(s.reorderAt) || 0;
  if (q <= 0) return 'out';
  if (q <= f) return 'low';
  return 'ok';
}

/* ----------------------------------------------------------------- data -- */

const ago = (days) => addInterval(today(), -days, 'days');

// Kept aside so the preview can swap between a furnished house and a fresh
// install — the empty states are a real screen and deserve to be looked at.
// Every model, serial and part number below is invented. The brands are real
// manufacturers because the sample reads better for it, but nothing here is a
// real product code — these end up in the README screenshots, and a demo is no
// place for a number somebody might take for their own.
const SEED = {
  equipment: [
    { id: 'eq1', name: 'Furnace / Air Conditioner', location: 'Basement', category: 'hvac',
      brand: 'Trane', model: 'HX-400 / AC-2200', serial: 'SN-0000-A / SN-0000-B', partNumber: '20x25x1',
      purchasedOn: '2019-03-28', installedOn: '2019-04-11',
      purchasedFrom: 'Midwest Heating & Air', orderNumber: 'MHA-00000',
      phone: '(555) 123-4567', email: 'service@midwest.example',
      notes: 'Furnace filter is behind the lower panel. The condensate line runs to the floor drain.',
      icon: 'furnace',
      parts: [{ label: 'Filter, online', url: 'example.com/parts/af-2025' },
        { label: 'Manual', url: 'example.com/manuals/hx-400' }] },
    { id: 'eq2', name: 'Kitchen Refrigerator', location: 'Kitchen', category: 'appliance',
      brand: 'LG', model: 'RF-900X', partNumber: 'WF-100', icon: 'refrigerator',
      purchasedOn: '2022-05-14', installedOn: '2022-05-16', parts: [] },
    // Bought and never given an installed date, which is the ordinary way a
    // record ends up half filled in — and what the chronological order falls
    // back on.
    { id: 'eq3', name: 'Water Softener', location: 'Basement', category: 'water',
      brand: 'Culligan', purchasedOn: '2017-07-20', icon: 'water', parts: [] },
    { id: 'eq4', name: 'Smoke Alarms', location: 'Hallway', category: 'safety',
      installedOn: '2023-01-09', icon: 'alarm', parts: [] },
    { id: 'eq5', name: 'Riding Mower', location: 'Garage', category: 'vehicle',
      brand: 'John Deere', model: 'LT-21', icon: 'mower', parts: [] },
  ],
  tasks: [
    { id: 't1', equipmentId: 'eq1', name: 'Replace Furnace Filter', lastDone: ago(122),
      intervalCount: 3, intervalUnit: 'months', partsUsed: [{ supplyId: 's1', quantity: 1 }] },
    { id: 't2', equipmentId: 'eq1', name: 'Professional Service', lastDone: ago(400),
      intervalCount: 1, intervalUnit: 'years', partsUsed: [] },
    { id: 't3', equipmentId: 'eq1', name: 'Clear Condensate Drain Line', lastDone: ago(170),
      intervalCount: 6, intervalUnit: 'months', partsUsed: [] },
    { id: 't4', equipmentId: 'eq2', name: 'Replace Water Filter', lastDone: ago(175),
      intervalCount: 6, intervalUnit: 'months', partsUsed: [{ supplyId: 's2', quantity: 1 }] },
    { id: 't5', equipmentId: 'eq2', name: 'Clean Condenser Coils', lastDone: ago(40),
      intervalCount: 6, intervalUnit: 'months', partsUsed: [] },
    { id: 't6', equipmentId: 'eq3', name: 'Add Salt', lastDone: ago(26),
      intervalCount: 1, intervalUnit: 'months', partsUsed: [{ supplyId: 's3', quantity: 2 }] },
    { id: 't7', equipmentId: 'eq4', name: 'Test Alarm', lastDone: ago(200),
      intervalCount: 6, intervalUnit: 'months', partsUsed: [] },
    // The job everybody is told to do when the clocks change, on the
    // schedule that says so — and never done, which used to read as "not
    // scheduled" and now reads as the next changeover.
    { id: 't8', equipmentId: 'eq4', name: 'Replace Battery', lastDone: null,
      schedule: 'clocks', clocks: ['spring', 'fall'],
      intervalCount: 1, intervalUnit: 'years', partsUsed: [] },
    { id: 't9', equipmentId: 'eq5', name: 'Oil Change', lastDone: ago(14),
      intervalCount: 6, intervalUnit: 'months', partsUsed: [] },
    { id: 't10', equipmentId: 'eq5', name: 'Sharpen Blades', lastDone: ago(95),
      intervalCount: 3, intervalUnit: 'months', partsUsed: [] },
    // Attached to no equipment, which is allowed and has its own layout:
    // one line of facts where every other tile has two. Also never done and
    // anchored to months, so its ring has to come from the schedule.
    { id: 't12', equipmentId: null, name: 'Rotate Mattress', lastDone: null,
      schedule: 'months', months: [5, 11],
      intervalCount: 6, intervalUnit: 'months', partsUsed: [] },
    // A job with an end: done once and finished, kept for the history
    // rather than scheduled again.
    { id: 't11', equipmentId: 'eq2', name: 'Register Warranty', lastDone: ago(300),
      schedule: 'date', onDate: ago(305), onDateYearly: false,
      intervalCount: 1, intervalUnit: 'years', partsUsed: [] },
  ],
  supplies: [
    // Locations here on purpose: parts are grouped by where they are kept,
    // from the same list of rooms the equipment uses. One is left without so
    // the Unassigned group has something in it.
    { id: 's1', name: '20x25x1 MERV 11', quantity: 3, reorderAt: 2, partNumber: 'AF-2025',
      purchasedFrom: 'Home Depot', location: 'Basement' },
    // One shop name and one link, because "Buy from" takes either and they
    // are shown differently: a name is a fact, a link is a chip to press.
    { id: 's2', name: 'Fridge Water Filter', quantity: 0, reorderAt: 1, partNumber: 'WF-100',
      purchasedFrom: 'https://www.example.com/parts/wf-100?ref=long_and_unreadable&variant=1',
      location: 'Kitchen' },
    { id: 's3', name: 'Softener Salt (40 lb)', quantity: 2, reorderAt: 2, location: 'Basement' },
    { id: 's4', name: '9V Battery', quantity: 8, reorderAt: 2 },
  ],
  log: [
    { id: 'l1', taskId: 't5', equipmentId: 'eq2', taskName: 'Clean Condenser Coils',
      doneOn: ago(40), notes: 'Vacuumed the coils and the drip pan.', cost: '',
      recordedAt: Date.now() - 4e9, previousLastDone: ago(220), usedParts: [] },
    { id: 'l2', taskId: 't9', equipmentId: 'eq5', taskName: 'Oil Change',
      doneOn: ago(14), notes: '', cost: '34.50', recordedAt: Date.now() - 1e9,
      previousLastDone: ago(200), usedParts: [] },
    // Older entries, so the sample house has a history worth looking at: the
    // list groups by year and can be narrowed to the last few months, and
    // neither is exercised by a log that only reaches back a month.
    { id: 'l3', taskId: 't2', equipmentId: 'eq1', taskName: 'Replace Furnace Filter',
      doneOn: ago(130), notes: 'Old one was grey. Bought a four-pack this time.',
      cost: '18.99', recordedAt: Date.now() - 1.1e10, previousLastDone: ago(220),
      usedParts: [{ supplyId: 's1', quantity: 1 }] },
    { id: 'l4', taskId: 't1', equipmentId: 'eq1', taskName: 'Professional Service',
      doneOn: ago(330), notes: 'Capacitor replaced under warranty. Blower wheel cleaned.',
      cost: '0', recordedAt: Date.now() - 2.8e10, previousLastDone: ago(700), usedParts: [] },
    { id: 'l5', taskId: 't6', equipmentId: 'eq3', taskName: 'Flush Tank / Sediment Drain',
      doneOn: ago(470), notes: 'A lot of sediment. Worth doing every year.',
      cost: '', recordedAt: Date.now() - 4e10, previousLastDone: null, usedParts: [] },
  ],
  settings: { theme: 'system', showLocations: true, textSize: 'default', textSizeNarrow: 'default', badgeOverdue: false, viewRoutines: 'list', viewEquipment: 'list', viewParts: 'list', cardsWide: 3, cardsNarrow: 2, contentWidth: 'default', sortEquipment: 'name', sortEquipmentDir: 'asc', sortPartsDir: 'asc', dueSoonDays: 14, notifyOverdue: true },
};

/* ---------------------------------------------------------------- store -- */

// Everything below mutates `data`; SEED stays as the pristine copy to reset to.
const data = JSON.parse(JSON.stringify(SEED));

const listeners = new Set();
let logSeq = 100;

function upsert(list, record) {
  const i = list.findIndex((r) => r.id === record.id);
  if (i === -1) list.push({ ...record });
  else list[i] = { ...list[i], ...record };
}

function applyOp(kind, p) {
  if (kind === 'equipment.put') upsert(data.equipment, p);
  else if (kind === 'equipment.delete') {
    data.equipment = data.equipment.filter((e) => e.id !== p.id);
    data.tasks = data.tasks.filter((t) => t.equipmentId !== p.id);
  } else if (kind === 'routine.put') upsert(data.tasks, p);
  else if (kind === 'routine.delete') data.tasks = data.tasks.filter((t) => t.id !== p.id);
  else if (kind === 'routine.lastDone') {
    const t = data.tasks.find((x) => x.id === p.id);
    // Doing the job ends a snooze, mirroring apply_op in store.py.
    if (t) { t.lastDone = p.doneOn; t.snoozedUntil = null; }
  } else if (kind === 'part.put') upsert(data.supplies, p);
  else if (kind === 'part.delete') data.supplies = data.supplies.filter((s) => s.id !== p.id);
  else if (kind === 'part.adjust') {
    const s = data.supplies.find((x) => x.id === p.id);
    if (s) s.quantity = Math.max(0, (Number(s.quantity) || 0) + Number(p.delta));
  } else if (kind === 'log.append') {
    if (!data.log.some((l) => l.id === p.id)) data.log.unshift(p);
  } else if (kind === 'log.remove') data.log = data.log.filter((l) => l.id !== p.id);
  else if (kind === 'settings.put') Object.assign(data.settings, p);
}

function snapshot() {
  const soon = data.settings.dueSoonDays || 14;
  const states = {};
  for (const t of data.tasks) states[t.id] = taskState(t, soon);
  const stock = {};
  for (const s of data.supplies) stock[s.id] = stockStatus(s);
  const vals = Object.values(states);
  return {
    equipment: data.equipment,
    tasks: data.tasks,
    supplies: data.supplies,
    log: data.log,
    settings: data.settings,
    computed: {
      today: today(),
      dueSoonDays: soon,
      states,
      stock,
      counts: {
        paused: vals.filter((s) => s.status === 'paused').length,
        snoozed: vals.filter((s) => s.status === 'snoozed').length,
        overdue: vals.filter((s) => s.status === 'overdue').length,
        due: vals.filter((s) => s.status === 'due').length,
        new: vals.filter((s) => s.status === 'new').length,
        done: vals.filter((s) => s.status === 'done').length,
        ok: vals.filter((s) => s.status === 'ok').length,
        lowStock: Object.values(stock).filter((s) => s !== 'ok').length,
        equipment: data.equipment.length,
      },
    },
  };
}

function notify() {
  for (const cb of listeners) cb(snapshot());
}

/* -------------------------------------------------------------- the hass -- */

// Visible to the test so it can assert on what the panel actually sent.
window.__sent = [];

const connection = {
  async sendMessagePromise(msg) {
    window.__sent.push(msg);
    // A real connection is never instant; a tick here is what surfaces a
    // double-tap or a missing busy guard.
    await new Promise((r) => setTimeout(r, 12));

    if (msg.type === 'elmer/apply') {
      for (const op of msg.ops) applyOp(op.kind, op.payload);
      notify();
      return { ok: true };
    }
    if (msg.type === 'elmer/complete') {
      const task = data.tasks.find((t) => t.id === msg.taskId);
      if (!task) throw { code: 'not_found', message: 'No such routine' };
      const wanted = msg.used && msg.used.length ? msg.used : (task.partsUsed || []);
      const taken = [];
      for (const u of wanted) {
        const s = data.supplies.find((x) => x.id === u.supplyId);
        if (!s) continue;
        const qty = Math.min(Math.max(0, Number(u.quantity) || 0), Math.max(0, Number(s.quantity) || 0));
        if (qty > 0) taken.push({ supplyId: u.supplyId, quantity: qty });
      }
      const doneOn = msg.doneOn || today();
      const entry = {
        id: `log_${logSeq += 1}`,
        taskId: msg.taskId,
        equipmentId: task.equipmentId,
        taskName: task.name,
        doneOn,
        notes: msg.notes || '',
        cost: msg.cost || '',
        recordedAt: Date.now(),
        previousLastDone: task.lastDone || null,
        usedParts: taken,
      };
      applyOp('routine.lastDone', { id: msg.taskId, doneOn });
      for (const u of taken) applyOp('part.adjust', { id: u.supplyId, delta: -u.quantity });
      applyOp('log.append', entry);
      notify();
      return { entry };
    }
    if (msg.type === 'elmer/import') {
      const incoming = msg.data || {};
      const take = (k) => (Array.isArray(incoming[k]) ? incoming[k] : []);
      if (!msg.merge) {
        data.equipment = take('equipment');
        data.tasks = take('tasks');
        data.supplies = take('supplies');
        data.log = take('log');
        if (incoming.settings) Object.assign(data.settings, incoming.settings);
      } else {
        if (incoming.settings) applyOp('settings.put', incoming.settings);
        for (const e of take('equipment')) applyOp('equipment.put', e);
        for (const t of take('tasks')) applyOp('routine.put', t);
        for (const s of take('supplies')) applyOp('part.put', s);
        for (const l of [...take('log')].reverse()) applyOp('log.append', l);
      }
      notify();
      return {
        counts: {
          equipment: take('equipment').length,
          routines: take('tasks').length,
          parts: take('supplies').length,
          history: take('log').length,
        },
      };
    }
    if (msg.type === 'elmer/undo') {
      const entry = data.log.find((l) => l.id === msg.logId);
      if (!entry) throw { code: 'not_found', message: 'No such history entry' };
      applyOp('routine.lastDone', { id: entry.taskId, doneOn: entry.previousLastDone });
      for (const u of entry.usedParts || []) applyOp('part.adjust', { id: u.supplyId, delta: u.quantity });
      applyOp('log.remove', { id: msg.logId });
      notify();
      return { ok: true };
    }
    throw { code: 'unknown', message: `unexpected ${msg.type}` };
  },

  subscribeMessage(cb, msg) {
    if (msg.type !== 'elmer/subscribe') return Promise.reject(new Error('bad subscribe'));
    listeners.add(cb);
    setTimeout(() => cb(snapshot()), 0);
    return Promise.resolve(() => listeners.delete(cb));
  },
};

const params = new URLSearchParams(location.search);

/**
 * Home Assistant does not only report its mode on `hass.themes` — it paints a
 * set of custom properties onto the document, and the panel reads them so it
 * sits inside whatever theme is running. Leaving them out made the harness
 * kinder than the real thing: every one of Elmer's own fallbacks applied,
 * which is not what happens in Home Assistant, where they are all supplied.
 * These are HA's default light and dark values.
 */
const HA_THEME = {
  light: {
    '--primary-background-color': '#fafafa',
    '--card-background-color': '#ffffff',
    '--secondary-background-color': '#e5e5e5',
    '--primary-text-color': '#212121',
    '--secondary-text-color': '#727272',
    '--divider-color': 'rgba(0, 0, 0, 0.12)',
  },
  dark: {
    '--primary-background-color': '#111111',
    '--card-background-color': '#1c1c1c',
    '--secondary-background-color': '#202020',
    '--primary-text-color': '#e1e1e1',
    '--secondary-text-color': '#9b9b9b',
    '--divider-color': 'rgba(225, 225, 225, 0.12)',
  },
};

window.__setHaTheme = (mode) => {
  const vars = HA_THEME[mode] || HA_THEME.light;
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  document.body.style.background = vars['--primary-background-color'];
};
window.__setHaTheme(params.get('dark') === '1' ? 'dark' : 'light');

const panel = document.createElement('elmer-panel');
panel.hass = {
  connection,
  themes: { darkMode: params.get('dark') === '1' },
  language: 'en',
  user: { is_admin: true, name: 'Phil' },
};
panel.narrow = params.get('narrow') === '1';
panel.panel = { config: { version: '1.8.1' } };
document.body.appendChild(panel);

// Handles the panel's request to open Home Assistant's sidebar, which proves
// the event is actually dispatched and composed past the shadow boundary.
window.__menuToggles = 0;
window.addEventListener('hass-toggle-menu', () => { window.__menuToggles += 1; });

window.__panel = panel;
window.__snapshot = snapshot;

/**
 * Swap the whole data set, for looking at what a fresh install shows.
 * 'empty' is what somebody sees the first time they open the panel.
 */
window.__setData = (mode) => {
  const next = mode === 'empty'
    ? { equipment: [], tasks: [], supplies: [], log: [], settings: { ...SEED.settings } }
    : JSON.parse(JSON.stringify(SEED));
  data.equipment = next.equipment;
  data.tasks = next.tasks;
  data.supplies = next.supplies;
  data.log = next.log;
  data.settings = next.settings;
  notify();
};

if (params.get('empty') === '1') window.__setData('empty');

window.__ready = true;
