// Every screen, as a function from state to a markup string.
//
// No framework and no virtual DOM: each view returns HTML, the panel sets it on
// the shadow root, and clicks are caught by one delegated listener reading
// `data-act`. For a few hundred rows that is both faster and smaller than
// shipping a library, and it means the panel is a single static file with no
// build step — which matters for something installed through HACS, where there
// is no opportunity to run a bundler.
//
// The cost is that every interpolation has to be escaped by hand, so all of them
// go through `html` or `esc` in util.js. There is no exception for any field.

import { icon, hasIcon, EQUIPMENT_ICONS } from './icons.js';
import {
  esc, html, raw, meter, relative, formatDay, categoryLabel, CATEGORIES,
  INTERVAL_UNITS, intervalText, safeHref, asLink, linkLabel, daysBetween, MONTHS,
} from './util.js';

/* ------------------------------------------------------------------ bits -- */

/**
 * No button here. Every screen that has something to add carries the same
 * labelled button in the header, in the same place, on every tab — a second
 * one in the middle of the page is the same action twice and moves the thing
 * you are looking for depending on whether the list happens to be empty.
 */
function emptyState({ ic, title, body }) {
  return html`<div class="empty">
    ${raw(icon(ic, 34))}
    <h3>${title}</h3>
    <p>${body}</p>
  </div>`;
}

/**
 * The search box that heads a list. One per tab, each with its own text, so
 * searching routines and then looking at parts does not hand you a parts list
 * silently narrowed by a word you typed on another screen.
 */
export function searchBox(state, placeholder) {
  return html`<div class="search">
    ${raw(icon('search', 16))}
    <input type="search" data-act="search" value="${state.query || ''}"
      placeholder="${placeholder}" aria-label="${placeholder}"
      autocomplete="off" spellcheck="false">
    ${raw(state.query
      ? `<button class="clear" data-act="search-clear" aria-label="Clear search">${icon('x', 15)}</button>`
      : '')}
  </div>`;
}

/**
 * The way back from a detail page, at the top of the content rather than in
 * the header — the header keeps the Elmer mark on every screen, so the trail
 * sits where the list's search box sits and the two line up.
 *
 * The section reads as the strong half and the page you are on as the quiet
 * one, which is the opposite of the usual breadcrumb: the only thing here you
 * can act on is the way back, so that is what the eye should land on. The one
 * chevron sits between them and points at the section, the direction you
 * would be travelling. There is no second arrow out at the left, which only
 * said the same thing twice.
 */
export function crumb(backLabel, current) {
  return html`<nav class="crumb" aria-label="Breadcrumb">
    <button class="up" data-act="back">${backLabel}</button>
    ${raw(icon('back', 13))}
    <span class="here" aria-current="page">${current}</span>
  </nav>`;
}

/** Lower-cased words from a record, for matching what was typed. */
function haystack(...parts) {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function equipmentGlyph(eq, size = 19) {
  const name = eq && eq.icon && hasIcon(eq.icon)
    ? eq.icon
    : (eq && eq.category && hasIcon(eq.category) ? eq.category : 'other');
  return `<div class="glyph">${icon(name, size)}</div>`;
}

/** Equipment name and location, as one subtitle line. */
function whereLine(eq, showLocations) {
  if (!eq) return '';
  const bits = [eq.name];
  if (showLocations && eq.location) bits.push(eq.location);
  return bits.filter(Boolean).join(' · ');
}

/* --------------------------------------------------------------- routines -- */

export function routineRow(row, state, opts = {}) {
  const t = row.task;
  const st = row.state;
  const eq = row.equipment;
  // Inside a piece of equipment, naming it on every row says nothing — the
  // interval is what you actually want there.
  const where = opts.hideEquipment
    ? `every ${intervalText(t.intervalCount, t.intervalUnit)}`
    : whereLine(eq, state.settings.showLocations);
  const tone = st.status === 'overdue' || st.status === 'due' ? st.status : '';
  const busy = opts.busy ? ' data-busy="1"' : '';

  return html`<div class="row" data-act="routine" data-id="${t.id}" role="button" tabindex="0">
    ${raw(meter(st))}
    <div class="body">
      <div class="title">${t.name}</div>
      <div class="sub"${raw(tone ? ` data-tone="${esc(tone)}"` : '')}>
        <b>${relative(st.daysLeft)}</b>
        ${raw(where ? `<span class="dot">·</span><span class="txt">${esc(where)}</span>` : '')}
      </div>
    </div>
    <button class="tick" data-act="complete" data-id="${t.id}"${raw(busy)}
      title="Mark done today" aria-label="Mark ${t.name} done today">${raw(icon('check', 17))}</button>
  </div>`;
}

// In urgency order, the same order the list sorts in.
const FILTERS = [
  ['all', 'All'],
  ['overdue', 'Overdue'],
  ['due', 'Due soon'],
  ['new', 'Never done'],
  ['ok', 'Up to date'],
];

/** The four real states, in the order they matter. 'all' is not a group. */
const GROUPS = FILTERS.filter(([key]) => key !== 'all');

/**
 * Does this routine answer to what was typed?
 *
 * Name, equipment and location together, because "furnace" and "basement" are
 * both reasonable things to go looking for and it is not obvious from the
 * outside which of the three a word belongs to.
 */
function matchesQuery(row, needle) {
  if (!needle) return true;
  return haystack(
    row.task.name,
    row.equipment && row.equipment.name,
    row.equipment && row.equipment.location,
  ).includes(needle);
}

export function routinesView(state) {
  const needle = (state.query || '').trim().toLowerCase();
  const rows = state.rows
    .filter((r) => state.filter === 'all' || r.state.status === state.filter)
    .filter((r) => matchesQuery(r, needle));
  const counts = state.computed.counts;

  // One control, not two. There used to be a strip of counting tiles above a
  // row of filter pills, and both did the same job — showed how many were in a
  // state and filtered to it when tapped. The count now lives in the pill.
  const pills = FILTERS.map(([key, label]) => {
    const n = key === 'all' ? state.tasks.length : (counts[key] || 0);
    // The figure reads first and the label under it, so an aria-label puts them
    // back in the order they would be spoken.
    return html`<button class="pill" data-act="filter" data-value="${key}"
      data-tone="${key}"${raw(n === 0 ? ' data-zero' : '')}
      aria-pressed="${state.filter === key}"
      aria-label="${label}: ${n} ${raw(n === 1 ? 'routine' : 'routines')}">
      <span class="n">${n}</span><span class="l">${label}</span>
    </button>`;
  });

  const search = searchBox(state, 'Search routines, equipment or location');

  let body;
  if (!state.tasks.length) {
    body = emptyState({
      ic: 'today',
      title: 'Nothing to track yet',
      // Both ways in, because neither one is a precondition for the other: a
      // routine can stand on its own, and the equipment path is a shortcut
      // rather than a requirement.
      body: state.equipment.length
        ? 'Use Add Routine above, or open a piece of equipment for the routines Elmer suggests for it.'
        : 'Use Add Routine above for anything you want reminding of. Or add a piece of equipment first, and Elmer will suggest the routines that usually go with it.',
    });
  } else if (!rows.length && needle) {
    body = emptyState({
      ic: 'search',
      title: 'Nothing matches that',
      body: `No routine, equipment or location matching \u201c${state.query.trim()}\u201d.`,
    });
  } else if (!rows.length) {
    const label = (FILTERS.find((f) => f[0] === state.filter) || [, 'that'])[1];
    body = emptyState({
      ic: 'check',
      title: `Nothing ${String(label).toLowerCase()}`,
      body: 'Tap All to see everything you are tracking.',
    });
  } else if (state.filter === 'all') {
    // Grouped by state, worst first. A flat list sorted by urgency already put
    // these in this order; the headings say where one state ends and the next
    // begins, which a run of thirteen rows does not. Narrowing with a pill
    // leaves one group, so the heading would only repeat the pill: filtered,
    // the list is flat.
    body = raw(GROUPS.map(([key, label]) => {
      const group = rows.filter((r) => r.state.status === key);
      if (!group.length) return '';
      return html`<div class="label">${label}<span class="count">${group.length}</span></div>
        <div class="card">${group.map((r) => routineRow(r, state, { busy: state.busy[r.task.id] }))}</div>`;
    }).join(''));
  } else {
    body = html`<div class="card">${rows.map((r) => routineRow(r, state, { busy: state.busy[r.task.id] }))}</div>`;
  }

  // The banner, stat strip and pills scroll with the list rather than being
  // pinned above it. They are things about this screen, not chrome — pinning
  // them is what made the furniture rearrange itself between screens.
  // With nothing tracked at all there is nothing to filter, and a row of five
  // zeros above an empty state is noise on the one screen where someone new
  // most needs a clear instruction.
  return html`<div class="scroll"><div class="pad">
    ${raw(state.tasks.length ? search + html`<div class="pills">${pills}</div>` : '')}
    ${raw(body)}
  </div></div>`;
}

/* -------------------------------------------------------------- equipment -- */

export function equipmentView(state) {
  if (!state.equipment.length) {
    return html`<div class="scroll"><div class="pad">${raw(emptyState({
      ic: 'equipment',
      title: 'No equipment yet',
      body: 'Start with the things that need a filter changed — the furnace, the fridge, the water system.',
    }))}</div></div>`;
  }

  const needle = (state.query || '').trim().toLowerCase();
  const matched = state.equipment.filter((eq) => !needle || haystack(
    eq.name, eq.location, eq.brand, eq.model, eq.partNumber,
    eq.serial, eq.orderNumber, eq.purchasedFrom,
  ).includes(needle));

  if (!matched.length) {
    return html`<div class="scroll"><div class="pad">
      ${raw(searchBox(state, 'Search equipment'))}
      ${raw(emptyState({
        ic: 'search',
        title: 'Nothing matches that',
        body: `No equipment matching \u201c${state.query.trim()}\u201d.`,
      }))}
    </div></div>`;
  }

  // Grouped by location when locations are in use, so the basement reads
  // together. One flat list otherwise.
  //
  // Keyed by the location as stored, with the leftovers under a key of their
  // own rather than under the word "Unassigned" — otherwise a house with a
  // room actually called that would merge the two.
  const UNPLACED = Symbol('unplaced');
  const groups = new Map();
  for (const eq of matched) {
    if (!state.settings.showLocations) {
      if (!groups.has('')) groups.set('', []);
      groups.get('').push(eq);
      continue;
    }
    const key = (eq.location || '').trim() || UNPLACED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(eq);
  }

  // Rooms alphabetically, and whatever has no room at the end. It is the one
  // heading that is not a place, and it is a leftovers pile rather than a
  // section of the house, so it reads as a footnote rather than sitting
  // between the O's and the U's.
  const sections = [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === UNPLACED) return 1;
      if (b[0] === UNPLACED) return -1;
      return String(a[0]).localeCompare(String(b[0]));
    })
    .map(([key, items]) => {
      const where = key === UNPLACED ? 'Unassigned' : key;
      const rows = items
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((eq) => {
          const tasks = state.tasks.filter((t) => t.equipmentId === eq.id);
          const worst = rollUp(tasks, state);
          const n = tasks.length;
          return html`<div class="row" data-act="equipment" data-id="${eq.id}" role="button" tabindex="0">
            ${raw(equipmentGlyph(eq))}
            <div class="body">
              <div class="title">${eq.name}</div>
              <div class="sub">
                <span class="txt">${n} ${raw(n === 1 ? 'routine' : 'routines')}${raw(
                  eq.brand || eq.model ? ` · ${esc([eq.brand, eq.model].filter(Boolean).join(' '))}` : ''
                )}</span>
              </div>
            </div>
            ${raw(worst === 'idle' ? '' : `<span class="tag" data-tone="${esc(worst)}">${esc(worst)}</span>`)}
            ${raw(icon('chevron', 16))}
          </div>`;
        });
      return html`${raw(where ? `<div class="label">${esc(where)}</div>` : '')}
        <div class="card">${rows}</div>`;
    });

  return html`<div class="scroll"><div class="pad">
    ${raw(searchBox(state, 'Search equipment'))}
    ${sections}
  </div></div>`;
}

function rollUp(tasks, state) {
  if (!tasks.length) return 'idle';
  let worst = 'ok';
  for (const t of tasks) {
    const s = (state.computed.states[t.id] || {}).status;
    if (s === 'overdue') return 'overdue';
    if (s === 'due') worst = 'due';
    else if (s === 'new' && worst === 'ok') worst = 'idle';
  }
  return worst;
}

export function equipmentDetail(state, id) {
  const eq = state.equipment.find((e) => e.id === id);
  if (!eq) return html`<div class="center">That equipment is gone.</div>`;

  const rows = state.rows.filter((r) => r.task.equipmentId === id);
  const facts = [];
  const add = (k, v, cls) => {
    if (v) facts.push(html`<dt>${k}</dt><dd${raw(cls ? ` class="${cls}"` : '')}>${v}</dd>`);
  };
  add('Location', eq.location);
  add('Category', categoryLabel(eq.category));
  add('Brand', eq.brand);
  add('Model', eq.model, 'mono');
  add('Serial', eq.serial, 'mono');
  add('Part number', eq.partNumber, 'mono');
  // Bought, then fitted, then where from and under which order — the order a
  // receipt is read in, and the order you would retrace to make a claim.
  add('Purchased', eq.purchasedOn ? formatDay(eq.purchasedOn, state.computed.today) : '');
  add('Installed', eq.installedOn ? formatDay(eq.installedOn, state.computed.today) : '');
  add('Purchased from', eq.purchasedFrom);
  add('Order number', eq.orderNumber, 'mono');

  const tel = safeHref(eq.phone ? `tel:${String(eq.phone).replace(/[^\d+]/g, '')}` : '');
  if (eq.phone) {
    facts.push(html`<dt>Phone</dt><dd>${raw(
      tel ? `<a href="${esc(tel)}">${esc(eq.phone)}</a>` : esc(eq.phone)
    )}</dd>`);
  }
  if (eq.email) {
    facts.push(html`<dt>Email</dt><dd>${raw(`<a href="mailto:${esc(eq.email)}">${esc(eq.email)}</a>`)}</dd>`);
  }

  const links = (eq.parts || []).filter((l) => l && l.url);
  const linkRows = links.map((l) => {
    const href = safeHref(l.url);
    const label = linkLabel(l);
    return href
      ? html`<a class="row" href="${href}" target="_blank" rel="noopener noreferrer">
          ${raw(icon('link', 17))}<div class="body"><div class="title">${label}</div></div>
        </a>`
      : html`<div class="row">${raw(icon('link', 17))}<div class="body"><div class="title">${label}</div></div></div>`;
  });

  return html`<div class="scroll"><div class="pad">
    ${raw(crumb('Equipment', eq.name))}
    ${raw(facts.length ? `<div class="card"><dl class="kv">${facts.join('')}</dl></div>` : '')}
    ${raw(eq.notes ? `<div class="label">Notes</div><div class="card"><div class="note">${esc(eq.notes)}</div></div>` : '')}

    <div class="label">Routines</div>
    ${raw(rows.length
      ? `<div class="card">${rows.map((r) => routineRow(r, state, { busy: state.busy[r.task.id], hideEquipment: true })).join('')}</div>`
      : `<div class="card"><div class="note">No routines yet. Add one to start tracking this.</div></div>`)}
    <div class="btnrow">
      <button class="btn" data-act="add-routine" data-id="${eq.id}">${raw(icon('plus', 16))}Add routine</button>
    </div>

    ${raw(linkRows.length ? `<div class="label">Links</div><div class="card">${linkRows.join('')}</div>` : '')}

    <div class="btnrow">
      <button class="btn" data-act="edit-equipment" data-id="${eq.id}">${raw(icon('edit', 16))}Edit</button>
      <button class="btn" data-variant="danger" data-act="delete-equipment" data-id="${eq.id}">${raw(icon('trash', 16))}Delete</button>
    </div>
  </div></div>`;
}

/* ------------------------------------------------------------------ parts -- */

/**
 * One part, on a page of its own rather than straight into the edit form —
 * the same shape as a piece of equipment, because they are the same kind of
 * thing to look at: some facts, what depends on it, then the way to change it.
 */
export function partDetail(state, id) {
  const part = state.supplies.find((s2) => s2.id === id);
  if (!part) return html`<div class="center">That part is gone.</div>`;

  const tone = state.computed.stock[part.id] || 'ok';
  const users = state.rows.filter(
    (r) => (r.task.partsUsed || []).some((u) => u.supplyId === part.id),
  );

  const facts = [];
  const add = (label, value, cls) => {
    if (value || value === 0) {
      facts.push(html`<dt>${label}</dt><dd${raw(cls ? ` class="${cls}"` : '')}>${value}</dd>`);
    }
  };
  // Not 'On hand' — that is the large figure at the top of the page, and
  // saying it twice makes the reader check whether they differ.
  add('Reorder at', part.reorderAt);
  add('Part number', part.partNumber, 'mono');
  // "Buy from" is a free field: a shop name is a fact, a link is a thing to
  // press. Only a real http(s) address becomes the chip — safeHref rejects a
  // javascript: url — and a shop name stays a row like the others.
  const buy = asLink(part.purchasedFrom);
  if (part.purchasedFrom && !buy) add('Buy from', part.purchasedFrom);

  return html`<div class="scroll"><div class="pad">
    ${raw(crumb('Parts', part.name))}

    <!-- One card, not two. How many are on the shelf and what to reorder at
         are the same subject, and splitting them made the page read as a
         readout followed by an unrelated table. The card opens the edit form;
         the stepper inside it does not, because a click resolves to the
         nearest thing that handles one. -->
    <div class="card onepart" data-act="edit-part" data-id="${part.id}"
      role="button" tabindex="0" aria-label="Edit ${part.name}">
      <div class="row stockrow">
        <div class="qty" data-tone="${tone}">${part.quantity}</div>
        <div class="body">
          <div class="title">${part.name}</div>
          <!-- The count is the figure in the chip beside this; the words say
               what it means. -->
          <div class="sub"><span class="txt">${raw(
            tone === 'out' ? 'None left' : tone === 'low' ? 'Running low' : 'In stock'
          )}</span></div>
        </div>
        <div class="stepper">
          <button class="iconbtn" data-act="stock" data-id="${part.id}" data-delta="-1"
            aria-label="One fewer ${part.name}">${raw(icon('minus', 16))}</button>
          <button class="iconbtn" data-act="stock" data-id="${part.id}" data-delta="1"
            aria-label="One more ${part.name}">${raw(icon('plus', 16))}</button>
        </div>
      </div>
      ${raw(facts.length || buy ? `<div class="factrow">
        ${facts.length ? `<dl class="kv">${facts.join('')}</dl>` : '<div class="kv"></div>'}
        ${buy ? `<a class="chip" href="${esc(buy)}"
          target="_blank" rel="noopener noreferrer">${icon('link', 14)}Buy</a>` : ''}
      </div>` : '')}
    </div>
    ${raw(part.notes ? `<div class="label">Notes</div><div class="card"><div class="note">${esc(part.notes)}</div></div>` : '')}

    <div class="label">Used by</div>
    ${raw(users.length
      ? `<div class="card">${users.map((r) => routineRow(r, state, { busy: state.busy[r.task.id] })).join('')}</div>`
      : `<div class="card"><div class="note">No routine uses this yet. Add it to one and marking that routine done will take it off the shelf.</div></div>`)}

    <div class="btnrow">
      <button class="btn" data-variant="danger" data-act="delete-part" data-id="${part.id}">${raw(icon('trash', 16))}Delete</button>
    </div>
  </div></div>`;
}


export function partsView(state) {
  if (!state.supplies.length) {
    return html`<div class="scroll"><div class="pad">${raw(emptyState({
      ic: 'supplies',
      title: 'No parts on hand',
      body: 'Track the filters and cartridges you keep in the cupboard. Completing a routine takes them off the shelf automatically.',
    }))}</div></div>`;
  }

  const needle = (state.query || '').trim().toLowerCase();
  const matched = state.supplies.filter((p) => !needle || haystack(
    p.name, p.partNumber,
  ).includes(needle));

  if (!matched.length) {
    return html`<div class="scroll"><div class="pad">
      ${raw(searchBox(state, 'Search parts'))}
      ${raw(emptyState({
        ic: 'search',
        title: 'Nothing matches that',
        body: `No part matching \u201c${state.query.trim()}\u201d.`,
      }))}
    </div></div>`;
  }

  const order = { out: 0, low: 1, ok: 2 };
  const sorted = matched.slice().sort((a, b) => {
    const d = order[state.computed.stock[a.id] || 'ok'] - order[state.computed.stock[b.id] || 'ok'];
    return d !== 0 ? d : String(a.name || '').localeCompare(String(b.name || ''));
  });

  const rows = sorted.map((p) => {
    const tone = state.computed.stock[p.id] || 'ok';
    const uses = state.tasks.filter((t) => (t.partsUsed || []).some((u) => u.supplyId === p.id)).length;
    const bits = [];
    if (p.reorderAt) bits.push(`reorder at ${p.reorderAt}`);
    if (uses) bits.push(`${uses} ${uses === 1 ? 'routine' : 'routines'}`);
    if (p.partNumber) bits.push(p.partNumber);
    return html`<div class="row" data-act="part" data-id="${p.id}" role="button" tabindex="0">
      <div class="qty" data-tone="${tone}">${p.quantity}</div>
      <div class="body">
        <div class="title">${p.name}</div>
        <div class="sub"><span class="txt">${raw(bits.length ? esc(bits.join(' · ')) : 'on hand')}</span></div>
      </div>
      <div class="stepper">
        <button class="iconbtn" data-act="stock" data-id="${p.id}" data-delta="-1"
          aria-label="One fewer ${p.name}">${raw(icon('minus', 16))}</button>
        <button class="iconbtn" data-act="stock" data-id="${p.id}" data-delta="1"
          aria-label="One more ${p.name}">${raw(icon('plus', 16))}</button>
      </div>
    </div>`;
  });

  return html`<div class="scroll"><div class="pad">
    ${raw(searchBox(state, 'Search parts'))}
    <div class="card">${rows}</div>
  </div></div>`;
}

/* ---------------------------------------------------------------- history -- */

/** How far back the history list reaches. */
export const RANGES = [
  ['3m', '3 months', 92],
  ['12m', '12 months', 366],
  ['all', 'All time', null],
];

/** "Aug 9" — the day of an entry, for the timeline's left column. */
function shortDay(iso) {
  const parts = String(iso || '').split('-');
  if (parts.length < 3) return String(iso || '');
  const [, m, d] = parts.map(Number);
  return `${MONTHS[m - 1] || ''} ${d}`;
}

export function historyView(state) {
  if (!state.log.length) {
    return html`<div class="scroll"><div class="pad">${raw(emptyState({
      ic: 'history',
      title: 'No history yet',
      body: 'Every routine you mark done is recorded here, with what it used and what it cost.',
    }))}</div></div>`;
  }

  const range = RANGES.find(([key]) => key === state.range) || RANGES[RANGES.length - 1];
  const within = range[2];
  const kept = state.log
    .filter((l) => within === null || daysBetween(l.doneOn, state.computed.today) <= within)
    .slice()
    .sort((a, b) => String(b.doneOn || '').localeCompare(String(a.doneOn || '')))
    .slice(0, 300);

  const picker = html`<div class="seg" role="group" aria-label="How far back">
    ${RANGES.map(([key, label]) => html`<button data-act="range" data-value="${key}"
      aria-pressed="${range[0] === key}">${label}</button>`)}
  </div>`;

  const head = html`<div class="label">
    ${kept.length} ${raw(kept.length === 1 ? 'service' : 'services')} logged${raw(picker)}
  </div>`;

  if (!kept.length) {
    return html`<div class="scroll"><div class="pad">
      ${raw(head)}
      ${raw(emptyState({
        ic: 'history',
        title: 'Nothing in that window',
        body: 'Choose a longer stretch to see older entries.',
      }))}
    </div></div>`;
  }

  // By year, newest first. A log read top to bottom is a chronology, and the
  // year is the only heading it needs — every other grouping cuts across time.
  const years = new Map();
  for (const l of kept) {
    const y = String(l.doneOn || '').slice(0, 4) || '—';
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(l);
  }

  const sections = [...years.entries()].map(([year, entries]) => {
    const items = entries.map((l) => {
      const eq = state.equipment.find((e) => e.id === l.equipmentId);
      const parts = (l.usedParts || [])
        .map((u) => {
          const sup = state.supplies.find((x) => x.id === u.supplyId);
          return sup ? `${u.quantity} × ${sup.name}` : null;
        })
        .filter(Boolean);
      const bits = [];
      if (eq) bits.push(eq.name);
      if (parts.length) bits.push(parts.join(', '));
      // A cost of nothing is not worth a column. "0" is what a warranty job
      // gets typed in as, and "· 0" in the middle of a line reads as an error.
      if (l.cost && Number(String(l.cost).replace(/[^\d.-]/g, '')) !== 0) bits.push(l.cost);
      if (l.notes) bits.push(l.notes);

      return html`<li class="tl" data-act="log" data-id="${l.id}" role="button" tabindex="0">
        <span class="dot" aria-hidden="true"></span>
        <time class="when" datetime="${l.doneOn || ''}">${shortDay(l.doneOn)}</time>
        <div class="body">
          <div class="title">${l.taskName}</div>
          ${raw(bits.length ? `<div class="sub"><span class="txt">${esc(bits.join(' · '))}</span></div>` : '')}
        </div>
      </li>`;
    });

    return html`<div class="label">${year}<span class="count">${entries.length}</span></div>
      <ol class="timeline">${items}</ol>`;
  });

  return html`<div class="scroll"><div class="pad">
    ${raw(head)}
    ${sections}
    ${raw(state.log.length > kept.length && within === null
      ? `<div class="label">Showing the most recent 300 of ${state.log.length}</div>`
      : '')}
  </div></div>`;
}

/* --------------------------------------------------------------- settings -- */

/**
 * The locations and categories in use, with what uses them.
 *
 * Neither is a record of its own: they are whatever the equipment says they
 * are. So renaming one rewrites every piece that carries it, and removing one
 * clears the field on each — there is nothing else to delete. The count is
 * shown because both actions touch that many pieces at once.
 */
export function groupsInUse(state, field) {
  const counts = new Map();
  for (const eq of state.equipment) {
    const value = (eq[field] || '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => {
      // A category is either one of Elmer's own — which carries an icon and a
      // name of its own, and is not ours to rename — or free text somebody
      // typed, which is. A location is always free text.
      const built = field === 'category' ? categoryLabel(value) : null;
      return { value, count, label: built || value, builtIn: !!built };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function groupCard(state, field, empty) {
  const rows = groupsInUse(state, field);
  if (!rows.length) return html`<div class="card"><div class="note">${empty}</div></div>`;

  return html`<div class="card">${rows.map((g) => {
    const tally = `${g.count} ${g.count === 1 ? 'piece' : 'pieces'} of equipment`;
    return html`<div class="row groprow">
    <div class="body">
      <div class="title">${g.label}</div>
      <div class="sub"><span class="txt">${raw(g.builtIn ? `${esc(tally)} &middot; built in` : esc(tally))}</span></div>
    </div>
    ${raw(g.builtIn ? '' : html`<button class="iconbtn" data-act="rename-group" data-field="${field}" data-value="${g.value}"
      aria-label="Rename ${g.label}">${raw(icon('edit', 16))}</button>`)}
    <button class="iconbtn" data-act="clear-group" data-field="${field}" data-value="${g.value}"
      data-label="${g.label}" aria-label="Remove ${g.label}">${raw(icon('trash', 16))}</button>
  </div>`;
  })}</div>`;
}

/** Renaming one of them, in a form rather than a browser prompt. */
export function groupForm(state, field, value) {
  const found = groupsInUse(state, field).find((g) => g.value === value) || { count: 0 };
  const n = found.count;
  const what = field === 'location' ? 'location' : 'category';
  return html`<div class="field">
      <label for="f-group">Name</label>
      <input id="f-group" name="groupName" value="${value}" data-titlecase autocomplete="off">
      <div class="hint">Renaming changes it on ${n} ${raw(n === 1 ? 'piece' : 'pieces')} of equipment. A ${what} is not stored on its own — it is whatever the equipment says it is.</div>
    </div>
    <div class="btnrow">
      <button class="btn" data-act="close">Cancel</button>
      <button class="btn" data-variant="primary" data-act="save-group"
        data-field="${field}" data-value="${value}">Save</button>
    </div>`;
}

export function settingsView(state) {
  const s = state.settings;
  const themes = [['system', 'Follow Home Assistant'], ['light', 'Light'], ['dark', 'Dark']];
  const SIZES = [['small', 'Smaller'], ['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']];
  const counts = state.computed.counts;

  return html`<div class="scroll"><div class="pad">
    <div class="label">Appearance</div>
    <div class="card"><div style="padding:4px 12px 14px">
      <div class="field">
        <label for="theme">Theme</label>
        <select id="theme" data-act="set-theme">
          ${themes.map(([v, l]) => html`<option value="${v}"${raw(s.theme === v ? ' selected' : '')}>${l}</option>`)}
        </select>
        <div class="hint">Following Home Assistant means Elmer turns dark when the rest of your dashboard does.</div>
      </div>
    <!-- One size per reading distance. Both are editable from either kind of
         screen, so the phone can be fixed from the sofa without going and
         finding the phone. -->
    <div class="two">
      <div class="field">
        <label for="textsize">Desktop size</label>
        <select id="textsize" data-act="set-text">
          ${SIZES.map(([v, l]) => html`<option value="${v}"${raw((s.textSize || 'default') === v ? ' selected' : '')}>${l}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="textsize-n">Mobile size</label>
        <select id="textsize-n" data-act="set-text-narrow">
          ${SIZES.map(([v, l]) => html`<option value="${v}"${raw((s.textSizeNarrow || s.textSize || 'default') === v ? ' selected' : '')}>${l}</option>`)}
        </select>
      </div>
    </div>
      <div class="field">
        <div class="hint">Type and icons are already a little larger on a narrow screen than on a wide one, since a phone is held further away. These shift each further. Which applies follows the width of the window, so a desktop browser dragged narrow reads as a phone.</div>
      </div>
      <div class="field">
        <label for="locs">Show locations</label>
        <select id="locs" data-act="set-locations">
          <option value="1"${raw(s.showLocations ? ' selected' : '')}>Yes, group by location</option>
          <option value="0"${raw(!s.showLocations ? ' selected' : '')}>No, one flat list</option>
        </select>
      </div>
    </div></div>

    <div class="label">Locations</div>
    ${raw(groupCard(state, 'location', 'No locations yet. They appear here once a piece of equipment has one.'))}

    <div class="label">Categories</div>
    ${raw(groupCard(state, 'category', 'No categories yet. They appear here once a piece of equipment has one.'))}

    <div class="label">Scheduling</div>
    <div class="card"><div style="padding:4px 12px 14px">
      <div class="field">
        <label for="soon">Warn this many days ahead</label>
        <input id="soon" type="number" inputmode="numeric" min="0" max="365"
          value="${s.dueSoonDays}" data-act="set-soon">
        <div class="hint">Anything due within this many days counts as due soon. The sensors use the same number, so an automation and the panel always agree.</div>
      </div>
    </div></div>

    <div class="label">Where your data lives</div>
    <div class="card"><div class="note">Elmer keeps everything in Home Assistant's own storage, so it is included in your Home Assistant backups and restored with them — you do not need a separate backup for Elmer.

The same import and export below are available as the elmer.import_json and elmer.export_json actions, if you would rather do it from an automation or a script.</div></div>

    <div class="label">Data export</div>
    <div class="card"><div class="panelbody">
      <div class="note" style="padding:8px 0 4px">${counts.equipment} ${raw(counts.equipment === 1 ? 'piece' : 'pieces')} of equipment, ${state.tasks.length} ${raw(state.tasks.length === 1 ? 'routine' : 'routines')}, ${state.supplies.length} ${raw(state.supplies.length === 1 ? 'part' : 'parts')}, ${state.log.length} history ${raw(state.log.length === 1 ? 'entry' : 'entries')}.</div>
      <div class="btnrow">
        <button class="btn" data-act="export">${raw(icon('download', 16))}Export a copy</button>
        <button class="btn" data-act="import">${raw(icon('upload', 16))}Import a file</button>
      </div>
      <div class="hint" style="margin-top:10px">Exporting downloads a JSON file you can keep anywhere. Importing one asks whether to merge it into what is here or replace it.</div>
    </div></div>

    <div class="label">About</div>
    <div class="card"><dl class="kv">
      <dt>Version</dt><dd>${state.version}</dd>
      <dt>Today</dt><dd>${formatDay(state.computed.today, state.computed.today)}</dd>
    </dl></div>

    <div class="label">Support</div>
    <div class="card"><div class="support">
      <p>Elmer is built and maintained by Phil Ecker. It is free and open source, and everything it records stays on your own Home Assistant — no account, no tracking, nothing sent anywhere.</p>
      <p>If it has saved you a forgotten filter change or two, you are very welcome to buy me a coffee.</p>
      <a class="btn" data-variant="primary" href="https://buymeacoffee.com/philecker"
        target="_blank" rel="noopener noreferrer">${raw(icon('link', 16))}Buy me a coffee</a>
    </div></div>
  </div></div>`;
}

/** What importing a file asks before it touches anything. */
export function importForm(state, file) {
  const c = file.counts;
  return html`<div class="note" style="padding:8px 0 2px">
<b>${file.name}</b>

${c.equipment} ${raw(c.equipment === 1 ? 'piece' : 'pieces')} of equipment · ${c.routines} ${raw(c.routines === 1 ? 'routine' : 'routines')} · ${c.parts} ${raw(c.parts === 1 ? 'part' : 'parts')} · ${c.history} history ${raw(c.history === 1 ? 'entry' : 'entries')}</div>

    <div class="field">
      <label for="f-mode">How to bring it in</label>
      <select id="f-mode" name="mode">
        <option value="merge" selected>Merge — update what matches, keep the rest</option>
        <option value="replace">Replace — discard what is here first</option>
      </select>
      <div class="hint">Merging matches records by id, so re-importing a newer export updates what changed and loses nothing you have added here. Replacing throws away everything currently in Elmer, including history.</div>
    </div>

    <div class="btnrow">
      <button class="btn" data-act="close">Cancel</button>
      <button class="btn" data-variant="primary" data-act="confirm-import">${raw(icon('upload', 16))}Import</button>
    </div>`;
}

/* ------------------------------------------------------------------ forms -- */

/**
 * A dropdown of what is already in use, with an escape hatch for something
 * new — a free text box the first time, because there is nothing to choose
 * from yet.
 *
 * Shared by Located and Category. It is what stops "Basement", "basement" and
 * "Bsmt" becoming three different places that group separately, and the same
 * argument applies to categories.
 */
export function pickOrNew({ label, id, pickName, newName, known, current, newLabel, placeholder }) {
  const has = known.length > 0;
  if (!has) {
    return html`<div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" name="${newName}" value="${current}" placeholder="${placeholder}"
        data-titlecase autocomplete="off">
    </div>`;
  }

  // A value that is somehow not in the list still has to be editable, so it
  // opens on the new box rather than silently snapping to something else.
  const isKnown = known.some(([value]) => value === current);
  const picked = current && isKnown ? current : (current ? '__new__' : '');

  return html`<div class="field">
    <label for="${id}">${label}</label>
    <select id="${id}" name="${pickName}" data-act="pick-or-new" data-for="${newName}">
      <option value=""${raw(picked === '' ? ' selected' : '')}>—</option>
      ${known.map(([value, text]) => html`<option value="${value}"${raw(picked === value ? ' selected' : '')}>${text}</option>`)}
      <option value="__new__"${raw(picked === '__new__' ? ' selected' : '')}>${newLabel}</option>
    </select>
    <input name="${newName}" value="${picked === '__new__' ? current : ''}"
      placeholder="${placeholder}" data-titlecase autocomplete="off"
      style="margin-top:8px${raw(picked === '__new__' ? '' : ';display:none')}">
  </div>`;
}

/** Where a piece of equipment is. */
export function locationField(state, equipment) {
  const known = [...new Set(
    state.equipment.map((x) => (x.location || '').trim()).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b)).map((l) => [l, l]);

  return pickOrNew({
    label: 'Located',
    id: 'f-location',
    pickName: 'locationPick',
    newName: 'locationNew',
    known,
    current: (equipment.location || '').trim(),
    newLabel: 'New Location…',
    placeholder: 'Kitchen',
  });
}

/**
 * What kind of thing it is.
 *
 * The built-in categories plus any the house has invented, so one typed once
 * is offered thereafter. A custom one carries no suggested routines and falls
 * back to the generic icon, which is the cost of not being on the list.
 */
export function categoryField(state, equipment) {
  const builtIn = CATEGORIES.map(([v, l]) => [v, l]);
  const names = new Set(builtIn.map(([v]) => v));
  const custom = [...new Set(
    state.equipment.map((x) => (x.category || '').trim()).filter((c) => c && !names.has(c)),
  )].sort((a, b) => a.localeCompare(b)).map((c) => [c, c]);

  return pickOrNew({
    label: 'Category',
    id: 'f-category',
    pickName: 'categoryPick',
    newName: 'categoryNew',
    known: [...builtIn, ...custom],
    current: (equipment.category || '').trim(),
    newLabel: 'New Category…',
    placeholder: 'What kind of thing?',
  });
}

/**
 * One replacement-part link on the equipment form.
 *
 * Rendered here and appended by the panel when another is added, so a row
 * that arrives mid-edit is identical to one the form opened with.
 */
export function linkRow(link) {
  const l = link || {};
  return html`<div class="row linkrow">
    <div class="linkfields">
      <input class="linklabel" value="${l.label || ''}" placeholder="What it is"
        aria-label="What this link is" autocomplete="off">
      <input class="linkurl" value="${l.url || ''}" placeholder="example.com/part"
        aria-label="Address" autocomplete="off" spellcheck="false">
    </div>
    <button class="iconbtn" data-act="unlink" type="button"
      aria-label="Remove this link">${raw(icon('x', 16))}</button>
  </div>`;
}

export function equipmentForm(state, eq) {
  const e = eq || {};
  const chosen = e.icon || e.category || 'other';
  return html`<div class="field">
      <label for="f-name">Name</label>
      <input id="f-name" name="name" value="${e.name || ''}" placeholder="Kitchen refrigerator"
        data-titlecase autocomplete="off">
    </div>
    <div class="two">
      ${raw(locationField(state, e))}
      ${raw(categoryField(state, e))}
    </div>
    <div class="two">
      <div class="field">
        <label for="f-brand">Brand</label>
        <input id="f-brand" name="brand" value="${e.brand || ''}" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-model">Model</label>
        <input id="f-model" name="model" value="${e.model || ''}" autocomplete="off">
      </div>
    </div>
    <div class="field">
      <label for="f-serial">Serial</label>
      <input id="f-serial" name="serial" value="${e.serial || ''}" autocomplete="off">
    </div>
    <div class="two">
      <div class="field">
        <label for="f-purchasedOn">Purchased</label>
        <input id="f-purchasedOn" name="purchasedOn" type="date" value="${e.purchasedOn || ''}">
      </div>
      <div class="field">
        <label for="f-installedOn">Installed</label>
        <input id="f-installedOn" name="installedOn" type="date" value="${e.installedOn || ''}">
      </div>
    </div>
    <div class="two">
      <div class="field">
        <label for="f-purchasedFrom">Purchased from</label>
        <input id="f-purchasedFrom" name="purchasedFrom" value="${e.purchasedFrom || ''}" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-orderNumber">Order number</label>
        <input id="f-orderNumber" name="orderNumber" value="${e.orderNumber || ''}" autocomplete="off">
      </div>
    </div>
    <div class="two">
      <div class="field">
        <label for="f-phone">Phone</label>
        <input id="f-phone" name="phone" type="tel" value="${e.phone || ''}" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-email">Email</label>
        <input id="f-email" name="email" type="email" value="${e.email || ''}" autocomplete="off">
      </div>
    </div>
    <div class="field">
      <label for="f-notes">Notes</label>
      <textarea id="f-notes" name="notes">${e.notes || ''}</textarea>
    </div>
    <!-- Links to where a replacement is bought. They were shown on the detail
         page and carried through a save, but nothing could change one: a part
         that stopped being sold left a dead link with no way to remove it. -->
    <div class="field">
      <label>Links</label>
      <button class="btn" data-act="add-link" type="button">${raw(icon('plus', 15))}Add a link</button>
      <div class="hint">Where to buy a replacement, or the manual. Clearing the address drops a link.</div>
      <div class="linklist">${raw((e.parts || []).filter(Boolean).map((l) => linkRow(l)).join(''))}</div>
    </div>
    <div class="field">
      <label>Icon</label>
      <div class="iconpick">
        ${EQUIPMENT_ICONS.map((n) => html`<button type="button" data-act="pick-icon" data-value="${n}"
          aria-pressed="${chosen === n}" aria-label="${n}">${raw(icon(n, 20))}</button>`)}
      </div>
      <!-- Empty until somebody actually picks one. The highlight above shows
           what the category would give you, but storing that as a choice
           makes "I did not choose" indistinguishable from "I chose this" —
           and since a new piece started out as "other", every new piece was
           saved as having deliberately chosen the generic box, which then
           beat its own category for both the glyph and the suggestions. -->
      <input type="hidden" name="icon" value="${e.icon || ''}">
    </div>
    <div class="btnrow">
      <button class="btn" data-act="close">Cancel</button>
      <button class="btn" data-variant="primary" data-act="save-equipment"
        data-id="${e.id || ''}">Save</button>
    </div>`;
}

/**
 * One part a routine consumes. Rendered here and, when a part is picked from
 * the dropdown, appended by the panel using the same function — so a row added
 * mid-edit is identical to one the form opened with.
 */
export function partRow(supply, quantity) {
  return html`<div class="row partrow" data-part="${supply.id}">
    <div class="body">
      <div class="title">${supply.name}</div>
      <div class="sub"><span class="txt">${supply.quantity} on hand</span></div>
    </div>
    <input class="qty" type="number" inputmode="numeric" min="1" max="99"
      name="part:${supply.id}" value="${quantity}" aria-label="How many ${supply.name}">
    <button class="iconbtn" data-act="unpick-part" data-id="${supply.id}"
      aria-label="This routine does not use ${supply.name}">${raw(icon('x', 16))}</button>
  </div>`;
}

/** The picker's options: everything not already on the routine. */
export function partOptions(state, used) {
  const taken = new Set((used || []).map((u) => u.supplyId));
  const free = state.supplies.filter((p) => !taken.has(p.id));
  return html`<option value="">${raw(free.length ? 'Add a part…' : 'All parts added')}</option>
    ${free.map((p) => html`<option value="${p.id}">${p.name}</option>`)}`;
}

export function routineForm(state, task, equipmentId) {
  const t = task || {};
  const eqId = t.equipmentId || equipmentId || '';
  const used = t.partsUsed || [];
  return html`<div class="field">
      <label for="f-rname">Routine</label>
      <input id="f-rname" name="name" value="${t.name || ''}" placeholder="Replace air filter"
        data-titlecase autocomplete="off">
    </div>
    <div class="field">
      <label for="f-equipment">Equipment</label>
      <select id="f-equipment" name="equipmentId">
        <option value="">—</option>
        ${state.equipment.map((e) => html`<option value="${e.id}"${raw(eqId === e.id ? ' selected' : '')}>${e.name}</option>`)}
      </select>
    </div>
    <div class="two">
      <div class="field">
        <label for="f-count">Every</label>
        <input id="f-count" name="intervalCount" type="number" inputmode="numeric" min="1" max="999"
          value="${t.intervalCount || 3}">
      </div>
      <div class="field">
        <label for="f-unit">Unit</label>
        <select id="f-unit" name="intervalUnit">
          ${INTERVAL_UNITS.map(([v, l]) => html`<option value="${v}"${raw((t.intervalUnit || 'months') === v ? ' selected' : '')}>${l}</option>`)}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="f-lastDone">Last done</label>
      <input id="f-lastDone" name="lastDone" type="date" value="${t.lastDone || ''}">
      <div class="hint">Leave this empty if you have never done it — Elmer will show it as never done rather than inventing a date.</div>
    </div>
    ${raw(state.supplies.length ? html`<div class="field">
      <label for="f-pickpart">Parts this uses</label>
      <select id="f-pickpart" data-act="pick-part" aria-label="Add a part this routine uses">
        ${raw(partOptions(state, used))}
      </select>
      <div class="hint">Only the parts this routine actually uses — marking it done takes them off the shelf.</div>
      <div class="partlist">${used.map((u) => {
        const p = state.supplies.find((x) => x.id === u.supplyId);
        return p ? partRow(p, u.quantity) : '';
      })}</div>
    </div>` : '')}
    <div class="btnrow">
      <button class="btn" data-act="close">Cancel</button>
      ${raw(t.id ? `<button class="btn" data-variant="danger" data-act="delete-routine" data-id="${esc(t.id)}">${icon('trash', 16)}</button>` : '')}
      <button class="btn" data-variant="primary" data-act="save-routine" data-id="${t.id || ''}">Save</button>
    </div>`;
}

export function partForm(state, part) {
  const p = part || {};
  return html`<div class="field">
      <label for="f-pname">Part</label>
      <input id="f-pname" name="name" value="${p.name || ''}" placeholder="20x25x1 MERV 11"
        data-titlecase autocomplete="off">
    </div>
    <div class="two">
      <div class="field">
        <label for="f-qty">On hand</label>
        <input id="f-qty" name="quantity" type="number" inputmode="numeric" min="0" max="9999"
          value="${p.quantity === undefined ? 1 : p.quantity}">
      </div>
      <div class="field">
        <label for="f-reorder">Reorder at</label>
        <input id="f-reorder" name="reorderAt" type="number" inputmode="numeric" min="0" max="9999"
          value="${p.reorderAt === undefined ? 1 : p.reorderAt}">
      </div>
    </div>
    <div class="two">
      <div class="field">
        <label for="f-pnum">Part number</label>
        <input id="f-pnum" name="partNumber" value="${p.partNumber || ''}" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-pfrom">Buy from</label>
        <input id="f-pfrom" name="purchasedFrom" value="${p.purchasedFrom || ''}" autocomplete="off">
      </div>
    </div>
    <div class="field">
      <label for="f-pnotes">Notes</label>
      <textarea id="f-pnotes" name="notes">${p.notes || ''}</textarea>
    </div>
    <div class="btnrow">
      <button class="btn" data-act="close">Cancel</button>
      ${raw(p.id ? `<button class="btn" data-variant="danger" data-act="delete-part" data-id="${esc(p.id)}">${icon('trash', 16)}</button>` : '')}
      <button class="btn" data-variant="primary" data-act="save-part" data-id="${p.id || ''}">Save</button>
    </div>`;
}

/** The dialog behind a long-press or a row tap: log a service with detail. */
export function logForm(state, taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return html`<div class="note">That routine is gone.</div>`;
  const eq = state.equipment.find((e) => e.id === task.equipmentId);
  const st = state.computed.states[taskId] || {};
  const used = task.partsUsed || [];

  return html`<dl class="kv" style="padding:4px 0 10px">
      ${raw(eq ? `<dt>Equipment</dt><dd>${esc(eq.name)}</dd>` : '')}
      <dt>Every</dt><dd>${intervalText(task.intervalCount, task.intervalUnit)}</dd>
      <dt>Last done</dt><dd>${raw(task.lastDone ? esc(formatDay(task.lastDone, state.computed.today)) : 'never')}</dd>
      ${raw(st.due ? `<dt>Due</dt><dd>${esc(formatDay(st.due, state.computed.today))} · ${esc(relative(st.daysLeft))}</dd>` : '')}
      ${raw(eq && eq.partNumber ? `<dt>Part number</dt><dd class="mono">${esc(eq.partNumber)}</dd>` : '')}
    </dl>
    <div class="label">Log a service</div>
    <div class="field">
      <label for="f-doneOn">Done on</label>
      <input id="f-doneOn" name="doneOn" type="date" value="${state.computed.today}">
    </div>
    <div class="two">
      <div class="field">
        <label for="f-cost">Cost</label>
        <input id="f-cost" name="cost" value="" placeholder="optional" autocomplete="off">
      </div>
      <div class="field">
        <label for="f-lnotes">Notes</label>
        <input id="f-lnotes" name="notes" value="" placeholder="optional" autocomplete="off">
      </div>
    </div>
    ${raw(used.length ? html`<div class="field">
      <label>Parts used</label>
      ${used.map((u) => {
        const p = state.supplies.find((s) => s.id === u.supplyId);
        if (!p) return '';
        return html`<div class="row" style="padding:7px 0;min-height:46px;border:0">
          <div class="body"><div class="title" style="font-size:14px">${p.name}</div>
            <div class="sub"><span class="txt">${p.quantity} on hand</span></div></div>
          <input type="number" inputmode="numeric" min="0" max="99" style="width:68px;min-height:38px"
            name="part:${p.id}" value="${u.quantity}" aria-label="How many ${p.name}">
        </div>`;
      })}
      <div class="hint">Elmer takes these off the shelf. It never takes more than you have.</div>
    </div>` : '')}
    <div class="btnrow">
      <button class="btn" data-act="edit-routine" data-id="${task.id}">${raw(icon('edit', 16))}Edit</button>
      <button class="btn" data-variant="primary" data-act="save-log" data-id="${task.id}">${raw(icon('check', 16))}Mark done</button>
    </div>`;
}

export function logDetail(state, logId) {
  const l = state.log.find((x) => x.id === logId);
  if (!l) return html`<div class="note">That entry is gone.</div>`;
  const eq = state.equipment.find((e) => e.id === l.equipmentId);
  const parts = (l.usedParts || []).map((u) => {
    const p = state.supplies.find((s) => s.id === u.supplyId);
    return p ? `${u.quantity} × ${p.name}` : `${u.quantity} × (deleted part)`;
  });

  // Equipment first: the sheet is titled "History entry", so what this was
  // done to is the thing that identifies it. The date is the detail.
  return html`<dl class="kv" style="padding:4px 0 10px">
      ${raw(eq ? `<dt>Equipment</dt><dd>${esc(eq.name)}</dd>` : '')}
      <dt>Done on</dt><dd>${formatDay(l.doneOn, state.computed.today)}</dd>
      ${raw(l.cost ? `<dt>Cost</dt><dd>${esc(l.cost)}</dd>` : '')}
      ${raw(parts.length ? `<dt>Parts used</dt><dd>${esc(parts.join(', '))}</dd>` : '')}
      ${raw(l.previousLastDone ? `<dt>Previous</dt><dd>${esc(formatDay(l.previousLastDone, state.computed.today))}</dd>` : '')}
    </dl>
    ${raw(l.notes ? `<div class="label">Notes</div><div class="note" style="padding:0 0 12px">${esc(l.notes)}</div>` : '')}
    <div class="btnrow">
      <button class="btn" data-act="close">Close</button>
      <button class="btn" data-variant="danger" data-act="undo" data-id="${l.id}">${raw(icon('undo', 16))}Undo</button>
    </div>`;
}
