/**
 * Elmer's own date picker, for the one place the platform's cannot be used.
 *
 * The Home Assistant app for Mac is the iPad app run on macOS (Mac Catalyst),
 * and a date field there gets UIKit's picker: an iPad popover with a tinted
 * selection, a Reset button and a check mark. The operating system draws it
 * outside the page, so nothing in a stylesheet reaches it, and it looks like
 * no other control in the panel. A browser on the same Mac draws an ordinary
 * desktop calendar that does fit. So in that app, and only there, a date field
 * opens this instead.
 *
 * Everywhere else the platform's own picker is left alone. In a browser it is
 * the one people know and it already looks right; on a phone it is the better
 * control, sized for a thumb, and the app on an iPhone or iPad is the device
 * its picker was designed for.
 */
import { MONTHS_LONG } from './util.js';
import { icon } from './icons.js';

/*
 * The app names itself in the user agent, and says which system it is on:
 *
 *   ... Home Assistant/2026.11.0 (io.robbie.HomeAssistant; build:2026.1234; macOS 15.1.0) Mobile/HomeAssistant, like Safari
 *
 * On a Mac the system is hard-coded to "macOS", because UIKit itself reports
 * iOS there (DeviceWrapper.systemName in home-assistant/iOS). An iPhone or
 * iPad says iOS or iPadOS and is left out on purpose.
 */
const MAC_APP = /\bHome Assistant\/\S+ \([^)]*;\s*macOS [\d.]+\)/;

export function wantsOwnCalendar(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return MAC_APP.test(ua || '');
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Which day a week starts on, 0 for Sunday, from Home Assistant's own setting.
 *
 * The profile can name a day outright or say "language", which means whatever
 * the language's convention is. Not every engine can answer that, so it falls
 * back to Sunday, which is what the app's own picker shows in English.
 */
export function firstWeekday(locale) {
  const chosen = locale && locale.first_weekday;
  const named = WEEKDAY_NAMES.indexOf(String(chosen || '').toLowerCase());
  if (named >= 0) return named;
  try {
    const loc = new Intl.Locale((locale && locale.language) || 'en-US');
    const info = (typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo);
    // Intl counts 1 for Monday through 7 for Sunday.
    if (info && info.firstDay) return info.firstDay % 7;
  } catch { /* no week data in this engine */ }
  return 0;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 2026-02-31 is not a date; the Date constructor would quietly make it March.
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

function shift(iso, days) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** The same day of the month a number of months away, held to that month's end. */
function shiftMonths(iso, months) {
  const d = fromIso(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toIso(d);
}

function readable(iso) {
  const d = fromIso(iso);
  return `${WEEKDAY_NAMES[d.getDay()].replace(/^./, (c) => c.toUpperCase())} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** Hold a date inside the field's min and max, either of which may be absent. */
function clampIso(iso, min, max) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));

/**
 * One calendar, opened against one date field at a time.
 *
 * It lives in the panel's overlay layer rather than inside the form, so the
 * form's scrolling box cannot clip it, and it is placed against the field in
 * window coordinates. The field stays the source of truth: picking a day
 * writes the field's value and fires the same input and change events typing
 * would, so the form that reads it needs to know nothing about any of this.
 *
 * Three views, the way a phone's calendar has them. Days is where it opens.
 * The month and year at the top is a button that steps out to the twelve
 * months of that year, and again to a page of twelve years — a birthdate
 * eleven years back is three presses rather than a hundred and thirty-two
 * presses of the arrow. Picking a year steps back in to its months, picking
 * a month back in to its days.
 *
 * The field's min and max are honoured the way a browser's own picker
 * honours them: a day outside them cannot be chosen, nor a month or a year
 * with nothing inside them, and the keyboard stops at the edge.
 */
export class Calendar {
  constructor(layer) {
    this.layer = layer;
    this.el = null;
    this.input = null;
    this.focus = null;     // the day the keyboard is on, as an ISO date
    this.view = null;      // { y, m } — the month on show, m from 0
    this.mode = 'days';    // or 'months' or 'years'
    this.today = null;
    this.min = null;
    this.max = null;
    this.firstDay = 0;
    this.clearable = false;
    this.byKeyboard = false;

    this._onClick = this._onClick.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onOutside = this._onOutside.bind(this);
    this._onScroll = this._onScroll.bind(this);
    this._onResize = () => this.hide();
  }

  get isOpen() {
    return Boolean(this.el);
  }

  isFor(input) {
    return Boolean(this.el) && this.input === input;
  }

  /**
   * Open against a field.
   *
   * byKeyboard decides where focus goes back to afterwards. Opened from the
   * keyboard, the field had focus and gets it back. Opened with a click, the
   * field never took focus — that is how the system's own picker is kept from
   * opening — and handing it focus on the way out would invite that picker in.
   */
  show(input, { today, firstDay = 0, byKeyboard = false } = {}) {
    this.hide();
    this.input = input;
    this.today = today;
    this.firstDay = firstDay;
    this.byKeyboard = byKeyboard;
    this.clearable = input.hasAttribute('data-optional');
    this.min = fromIso(input.min) ? input.min : null;
    this.max = fromIso(input.max) ? input.max : null;
    this.mode = 'days';

    const current = fromIso(input.value) ? input.value : null;
    this.focus = clampIso(current || today, this.min, this.max);
    const f = fromIso(this.focus);
    this.view = { y: f.getFullYear(), m: f.getMonth() };

    const el = document.createElement('div');
    el.className = 'cal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    const label = input.id && input.getRootNode().querySelector(`label[for="${input.id}"]`);
    el.setAttribute('aria-label', `Choose a date${label ? ` — ${label.textContent.trim()}` : ''}`);
    el.addEventListener('click', this._onClick);
    el.addEventListener('keydown', this._onKey);
    // A press inside must not reach the panel's own press handling, and must
    // not take focus away from the day the keyboard is on.
    el.addEventListener('mousedown', (ev) => {
      if (!ev.target.closest('button')) ev.preventDefault();
    });
    this.el = el;
    this.layer.appendChild(el);
    this._paint();
    this._place();
    input.setAttribute('aria-expanded', 'true');

    window.addEventListener('pointerdown', this._onOutside, true);
    window.addEventListener('resize', this._onResize);
    this.layer.getRootNode().addEventListener('scroll', this._onScroll, true);

    this._focusCell();
  }

  hide({ restore = false } = {}) {
    if (!this.el) return;
    const { input, byKeyboard } = this;
    window.removeEventListener('pointerdown', this._onOutside, true);
    window.removeEventListener('resize', this._onResize);
    this.layer.getRootNode().removeEventListener('scroll', this._onScroll, true);
    this.el.remove();
    this.el = null;
    this.input = null;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      if (restore && byKeyboard && input.isConnected) input.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------ drawing */

  _outside(iso) {
    return Boolean((this.min && iso < this.min) || (this.max && iso > this.max));
  }

  /** Whether any day of a month, or of a year, is inside the min and max. */
  _monthOpen(y, m) {
    const first = toIso(new Date(y, m, 1));
    const last = toIso(new Date(y, m + 1, 0));
    return !(this.max && first > this.max) && !(this.min && last < this.min);
  }

  _yearOpen(y) {
    return !(this.max && `${y}-01-01` > this.max) && !(this.min && `${y}-12-31` < this.min);
  }

  _paint() {
    if (this.mode === 'months') this._paintMonths();
    else if (this.mode === 'years') this._paintYears();
    else this._paintDays();
  }

  _head(title, label, back, prevLabel, nextLabel, prevOff, nextOff) {
    return `
      <div class="cal-head">
        <button type="button" class="cal-title" data-cal="${back}" aria-label="${label}">${title}${icon('chevron', 14)}</button>
        <button type="button" class="cal-nav" data-cal="prev" aria-label="${prevLabel}"${prevOff ? ' disabled' : ''}>${icon('back', 18)}</button>
        <button type="button" class="cal-nav" data-cal="next" aria-label="${nextLabel}"${nextOff ? ' disabled' : ''}>${icon('chevron', 18)}</button>
      </div>`;
  }

  _paintDays() {
    const { y, m } = this.view;
    const value = this.input && fromIso(this.input.value) ? this.input.value : null;
    const first = new Date(y, m, 1);
    const lead = (first.getDay() - this.firstDay + 7) % 7;
    const start = new Date(y, m, 1 - lead);

    // Always six weeks, so the calendar keeps one height from month to month
    // and the buttons under it do not jump while you page through.
    const heads = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(this.firstDay + i) % 7]);
    let rows = '';
    for (let w = 0; w < 6; w += 1) {
      let cells = '';
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        const iso = toIso(d);
        const attrs = [
          `data-day="${iso}"`,
          `tabindex="${iso === this.focus ? 0 : -1}"`,
          `aria-label="${readable(iso)}"`,
          `aria-selected="${iso === value}"`,
        ];
        if (d.getMonth() !== m) attrs.push('data-outside');
        if (iso === this.today) attrs.push('aria-current="date"');
        if (this._outside(iso)) attrs.push('disabled');
        cells += `<button type="button" role="gridcell" class="cal-day" ${attrs.join(' ')}>${d.getDate()}</button>`;
      }
      rows += `<div class="cal-week" role="row">${cells}</div>`;
    }

    const foot = [
      `<button type="button" class="cal-link" data-cal="today"${this._outside(this.today) ? ' disabled' : ''}>Today</button>`,
      this.clearable ? '<button type="button" class="cal-link" data-cal="clear">Clear</button>' : '',
    ].join('');

    this.el.dataset.mode = 'days';
    this.el.innerHTML = `
      ${this._head(`${MONTHS_LONG[m]} ${y}`, `${MONTHS_LONG[m]} ${y}, choose a month and year`, 'months',
        'Previous month', 'Next month', !this._monthOpen(y, m - 1), !this._monthOpen(y, m + 1))}
      <div class="cal-grid" role="grid" aria-label="${MONTHS_LONG[m]} ${y}">
        <div class="cal-week cal-dow" role="row">${heads.map((h) => `<span role="columnheader">${h}</span>`).join('')}</div>
        ${rows}
      </div>
      <div class="cal-foot">${foot}</div>`;
  }

  _paintMonths() {
    const { y, m } = this.view;
    const cells = MONTHS_LONG.map((name, i) => {
      const open = this._monthOpen(y, i);
      const attrs = [
        `data-month="${i}"`,
        `tabindex="${i === m ? 0 : -1}"`,
        `aria-label="${name} ${y}"`,
        `aria-selected="${i === m}"`,
      ];
      if (this.today && Number(this.today.slice(0, 4)) === y && Number(this.today.slice(5, 7)) - 1 === i) {
        attrs.push('aria-current="date"');
      }
      if (!open) attrs.push('disabled');
      return `<button type="button" class="cal-cell" ${attrs.join(' ')}>${MONTHS_SHORT[i]}</button>`;
    }).join('');
    this.el.dataset.mode = 'months';
    this.el.innerHTML = `
      ${this._head(String(y), `${y}, choose a year`, 'years', 'Previous year', 'Next year',
        !this._yearOpen(y - 1), !this._yearOpen(y + 1))}
      <div class="cal-cells" role="grid" aria-label="Months of ${y}">${cells}</div>`;
  }

  _paintYears() {
    const { y } = this.view;
    const start = Math.floor(y / 12) * 12;
    const thisYear = this.today ? Number(this.today.slice(0, 4)) : null;
    let cells = '';
    for (let i = 0; i < 12; i += 1) {
      const year = start + i;
      const attrs = [
        `data-year="${year}"`,
        `tabindex="${year === y ? 0 : -1}"`,
        `aria-label="${year}"`,
        `aria-selected="${year === y}"`,
      ];
      if (year === thisYear) attrs.push('aria-current="date"');
      if (!this._yearOpen(year)) attrs.push('disabled');
      cells += `<button type="button" class="cal-cell" ${attrs.join(' ')}>${year}</button>`;
    }
    this.el.dataset.mode = 'years';
    this.el.innerHTML = `
      ${this._head(`${start} – ${start + 11}`, `${start} to ${start + 11}`, 'days', 'Earlier years', 'Later years',
        !this._yearOpen(start - 1), !this._yearOpen(start + 12))}
      <div class="cal-cells" role="grid" aria-label="Years ${start} to ${start + 11}">${cells}</div>`;
  }

  /**
   * Below the field, starting where its text starts — where a browser puts
   * its own. Above instead when there is not room below, and held inside the
   * window either way.
   */
  _place() {
    if (!this.el || !this.input) return;
    const r = this.input.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const gap = 6;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = r.bottom + gap;
    if (top + h > vh - margin && r.top - gap - h >= margin) top = r.top - gap - h;
    top = Math.max(margin, Math.min(top, vh - h - margin));
    const left = Math.max(margin, Math.min(r.left, vw - w - margin));

    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.left = `${Math.round(left)}px`;
    this.el.dataset.side = top < r.top ? 'above' : 'below';
  }

  /** Put the keyboard on whichever cell the current view has selected. */
  _focusCell() {
    const cell = this.el && this.el.querySelector('[data-day][tabindex="0"], [data-month][tabindex="0"], [data-year][tabindex="0"]');
    if (cell) cell.focus({ preventScroll: true });
  }

  /** Move the keyboard's day, turning the page if it leaves the month on show. */
  _moveTo(iso) {
    this.focus = clampIso(iso, this.min, this.max);
    const d = fromIso(this.focus);
    this.view = { y: d.getFullYear(), m: d.getMonth() };
    this._paint();
    this._focusCell();
  }

  _turn(months) {
    this._moveTo(shiftMonths(this.focus, months));
  }

  /** Step out to months or years, or back in to days. */
  _setMode(mode) {
    this.mode = mode;
    this._paint();
    this._focusCell();
  }

  /** Into the days of a month chosen from the months view. */
  _openMonth(y, m) {
    const day = fromIso(this.focus).getDate();
    const last = new Date(y, m + 1, 0).getDate();
    this.focus = clampIso(toIso(new Date(y, m, Math.min(day, last))), this.min, this.max);
    const f = fromIso(this.focus);
    this.view = { y: f.getFullYear(), m: f.getMonth() };
    this._setMode('days');
  }

  /* ------------------------------------------------------------ choosing */

  _pick(iso) {
    const input = this.input;
    if (!input) return;
    if (iso && this._outside(iso)) return;
    input.value = iso || '';
    // The events a person typing would have fired, composed so they reach
    // listeners outside the shadow root as well as the panel's own.
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    this.hide({ restore: true });
  }

  _onClick(ev) {
    const cell = ev.target.closest('button');
    if (!cell || cell.disabled) return;
    if (cell.dataset.day) {
      this._pick(cell.dataset.day);
      return;
    }
    if (cell.dataset.month) {
      this._openMonth(this.view.y, Number(cell.dataset.month));
      return;
    }
    if (cell.dataset.year) {
      this.view = { y: Number(cell.dataset.year), m: this.view.m };
      this._setMode('months');
      return;
    }
    switch (cell.dataset.cal) {
      case 'prev': this._page(-1, 'prev'); break;
      case 'next': this._page(1, 'next'); break;
      case 'months': this._setMode('months'); break;
      case 'years': this._setMode('years'); break;
      case 'days': this._setMode('days'); break;
      case 'today': this._pick(this.today); break;
      case 'clear': this._pick(''); break;
      default: break;
    }
  }

  /**
   * The arrows turn the page the view is on — a month, a year, or twelve
   * years. Painting replaces the button that was clicked, so focus goes back
   * onto its replacement and a keyboard user pressing Enter on Next can keep
   * pressing it.
   */
  _page(dir, which) {
    if (this.mode === 'days') {
      this.focus = clampIso(shiftMonths(this.focus, dir), this.min, this.max);
      const d = fromIso(this.focus);
      this.view = { y: d.getFullYear(), m: d.getMonth() };
    } else {
      this.view = { y: this.view.y + dir * (this.mode === 'years' ? 12 : 1), m: this.view.m };
    }
    this._paint();
    const again = this.el.querySelector(`[data-cal="${which}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
    else this._focusCell();
  }

  _onKey(ev) {
    const key = ev.key;
    if (key === 'Tab') {
      // Round the calendar rather than out of it: leaving is Escape, or
      // choosing a day. One stop for the grid, the cell the keyboard is on.
      const stops = [...this.el.querySelectorAll('button')]
        .filter((b) => !b.disabled && (!b.matches('[data-day], [data-month], [data-year]') || b.tabIndex === 0));
      const at = stops.indexOf(ev.target);
      const next = stops[(at + (ev.shiftKey ? -1 : 1) + stops.length) % stops.length];
      if (next) {
        ev.preventDefault();
        next.focus({ preventScroll: true });
      }
      return;
    }

    if (this.mode !== 'days') {
      const cell = ev.target.closest && ev.target.closest('[data-month], [data-year]');
      if (!cell) return;
      const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
      if (key in steps) {
        ev.preventDefault();
        if (this.mode === 'months') {
          const m = Math.max(0, Math.min(11, this.view.m + steps[key]));
          if (this._monthOpen(this.view.y, m)) this.view = { y: this.view.y, m };
        } else {
          const y = this.view.y + steps[key];
          if (this._yearOpen(y)) this.view = { y, m: this.view.m };
        }
        this._paint();
        this._focusCell();
      } else if (key === 'Enter' || key === ' ') {
        ev.preventDefault();
        cell.click();
      }
      return;
    }

    const onDay = ev.target.closest && ev.target.closest('[data-day]');
    if (!onDay) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (key in steps) {
      ev.preventDefault();
      this._moveTo(shift(this.focus, steps[key]));
    } else if (key === 'PageUp' || key === 'PageDown') {
      ev.preventDefault();
      this._turn((key === 'PageUp' ? -1 : 1) * (ev.shiftKey ? 12 : 1));
    } else if (key === 'Home' || key === 'End') {
      ev.preventDefault();
      const d = fromIso(this.focus);
      const into = (d.getDay() - this.firstDay + 7) % 7;
      this._moveTo(shift(this.focus, key === 'Home' ? -into : 6 - into));
    } else if (key === 'Enter' || key === ' ') {
      ev.preventDefault();
      this._pick(this.focus);
    }
  }

  _onOutside(ev) {
    const path = ev.composedPath();
    if (path.includes(this.el)) return;
    // A press on the field itself is the panel's to handle: it closes the
    // calendar as a toggle, and closing it here first would reopen it.
    if (this.input && path.includes(this.input)) return;
    this.hide();
  }

  /** Follow the field as the form scrolls, and let go once it is out of sight. */
  _onScroll(ev) {
    if (!this.el || (ev.target && ev.target.nodeType === 1 && this.el.contains(ev.target))) return;
    const box = this.input && this.input.closest('.inner');
    if (box) {
      const r = this.input.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.bottom < b.top || r.top > b.bottom) {
        this.hide();
        return;
      }
    }
    this._place();
  }
}
