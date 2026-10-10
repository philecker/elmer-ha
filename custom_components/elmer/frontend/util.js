// Small helpers shared by the views.

/**
 * Escape for interpolation into HTML.
 *
 * Every view builds its markup as a string, so this is the only thing standing
 * between a piece of equipment named `<img onerror=...>` and script running in
 * the panel. It is applied to every value without exception — there is no
 * "trusted" field, because all of them are free text somebody typed.
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolation. Arrays are joined. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    out += (Array.isArray(v) ? v.join('') : esc(v)) + strings[i + 1];
  }
  return out;
}

/** Marks a string as already-safe markup, for nesting rendered fragments. */
export function raw(markup) {
  return [markup === null || markup === undefined ? '' : String(markup)];
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar 2026", or "14 Mar" when it is this year. */
export function formatDay(iso, todayIso) {
  if (!iso) return '—';
  const parts = String(iso).split('-');
  if (parts.length < 3) return String(iso);
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return String(iso);
  const thisYear = todayIso ? Number(String(todayIso).slice(0, 4)) : null;
  const label = `${d} ${MONTHS[m - 1] || ''}`;
  return y === thisYear ? label : `${label} ${y}`;
}

/**
 * "in 12 days" / "31 days ago" / "today".
 *
 * Deliberately spelled out rather than abbreviated: the extra few characters
 * are what make a glance unambiguous.
 */
export function relative(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'not scheduled';
  if (daysLeft === 0) return 'due today';
  const n = Math.abs(daysLeft);
  const unit = describeSpan(n);
  return daysLeft > 0 ? `in ${unit}` : `${unit} ago`;
}

function describeSpan(days) {
  if (days === 1) return '1 day';
  if (days < 31) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 12) return months === 1 ? '1 month' : `${months} months`;
  const years = Math.round((days / 365.25) * 10) / 10;
  return years === 1 ? '1 year' : `${years} years`;
}

/** The short number inside the cycle meter: days, or months past 99. */
export function pip(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  const n = Math.abs(daysLeft);
  return n > 99 ? `${Math.round(n / 30)}m` : String(n);
}

const R = 13;
const CIRC = 2 * Math.PI * R;

/**
 * The ring. Its arc is the proportion of the service interval that has elapsed,
 * so a filter at 95% of its life reads as a nearly-closed ring before you have
 * read a single date. Overdue fills completely.
 */
export function meter(state) {
  const status = state && state.status ? state.status : 'new';
  const filled = status === 'overdue' ? 1 : Math.max(0.02, (state && state.progress) || 0);
  const offset = CIRC * (1 - filled);
  return `<div class="meter" data-status="${esc(status)}">
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle class="track" cx="17" cy="17" r="${R}" fill="none" stroke-width="2.5"/>
      <circle class="fill" cx="17" cy="17" r="${R}" fill="none" stroke-width="2.5"
        stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
    </svg>
    <div class="pip">${esc(pip(state && state.daysLeft))}</div>
  </div>`;
}

export const INTERVAL_UNITS = [
  ['days', 'days'],
  ['weeks', 'weeks'],
  ['months', 'months'],
  ['years', 'years'],
];

/**
 * An interval written the way it is said: "month", "3 months", "2 weeks".
 *
 * The unit is stored plural because that is what the picker offers, and the
 * count was printed straight beside it — so a routine that runs once a month
 * read "every 1 months". Rare until the pool arrived with two weekly routines
 * and made it the common case.
 */
export function intervalText(count, unit) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  const one = String(unit || 'months').replace(/s$/, '');
  return n === 1 ? one : `${n} ${one}s`;
}

export const CATEGORIES = [
  ['hvac', 'Heating & Cooling'],
  ['water', 'Water'],
  ['appliance', 'Appliance'],
  ['safety', 'Safety'],
  ['exterior', 'Exterior'],
  ['vehicle', 'Vehicle'],
  ['other', 'Other'],
];

export function categoryLabel(value) {
  const found = CATEGORIES.find((c) => c[0] === value);
  return found ? found[1] : null;
}

/**
 * Capitalise names the way you would write them, leaving anything that already
 * carries capitals or digits alone — so "kitchen refrigerator" becomes "Kitchen
 * Refrigerator" while WF-100, 20x25x1 and MERV survive untouched. Applied on
 * blur to names only, never to notes, models or serials.
 */
export function titleCase(value) {
  return (value || '').replace(/\S+/g, (word) => {
    if (/\d/.test(word) || /[A-Z]/.test(word.slice(1))) return word;
    return word.replace(/(^|[/-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  });
}

/** Accepts what somebody typed and makes it openable. */
export function normalizeUrl(input) {
  const v = (input || '').trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  return `https://${v}`;
}

/**
 * Only http(s), mailto and tel become links.
 *
 * The URL comes out of the data file, so a `javascript:` scheme would otherwise
 * run when tapped. Anything else is shown as text instead.
 */
export function safeHref(input) {
  const v = normalizeUrl(input);
  if (!v) return null;
  return /^(https?|mailto|tel):/i.test(v) ? v : null;
}

/**
 * A safe href, but only when the value actually looks like a web address.
 *
 * safeHref is deliberately forgiving: normalizeUrl puts https:// in front of
 * anything, which is right for a field whose whole purpose is a link. It is
 * wrong for deciding whether free text *is* one — "Home Depot" came back as
 * https://Home Depot and a shop name rendered as a button to press. This one
 * wants an explicit http(s) scheme, or something domain-shaped with no spaces
 * in it, and returns null for the rest so the caller can show it as text.
 */
export function asLink(value) {
  const v = String(value || '').trim();
  if (!v || /\s/.test(v)) return null;
  const scheme = /^https?:\/\//i.test(v);
  const domainish = /^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(v);
  if (!scheme && !domainish) return null;
  return safeHref(v);
}

export function linkLabel(link) {
  if (link.label && link.label.trim()) return link.label.trim();
  try {
    return new URL(normalizeUrl(link.url)).hostname.replace(/^www\./, '');
  } catch {
    return link.url || 'Link';
  }
}

/** Prefixed and random enough that two tabs minting ids at once will not clash. */
export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Days between two ISO days, parsed at noon so daylight saving cannot shift it. */
export function daysBetween(fromIso, toIso) {
  const a = parse(fromIso);
  const b = parse(toIso);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

function parse(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
