// Elmer, in the Home Assistant sidebar.
//
// A plain custom element — no Lit, no React, no build step. Home Assistant hands
// it a `hass` object with an authenticated websocket already open, which is what
// the panel reads and writes through. That has a useful consequence: remote
// access over Nabu Casa or a VPN needs no configuration here, because this is
// the same connection the rest of the interface already uses.
//
// The browser never computes a due date. Status arrives from the integration
// alongside the data, so the panel, the sensors and any automation cannot
// disagree — and a phone that has been asleep since yesterday cannot paint a
// stale "due tomorrow" from its own clock.

import { CSS } from './styles.js';
import { icon } from './icons.js';
import {
  esc, html, raw, titleCase, uid, todayIso,
} from './util.js';
import {
  routinesView, equipmentView, equipmentDetail, partsView, historyView, settingsView,
  equipmentForm, routineForm, partForm, logForm, logDetail, importForm,
  partRow, partOptions,
} from './views.js';

const TABS = [
  ['routines', 'Routines', 'today'],
  ['equipment', 'Equipment', 'equipment'],
  ['parts', 'Parts', 'supplies'],
  ['history', 'History', 'history'],
  ['settings', 'Settings', 'settings'],
];

const TEMPLATES = {
  hvac: [
    ['Replace air filter', 3, 'months'],
    ['Professional service', 1, 'years'],
    ['Clear condensate drain line', 6, 'months'],
  ],
  water: [
    ['Replace filter cartridge', 6, 'months'],
    ['Flush tank / sediment drain', 1, 'years'],
    ['Check anode rod', 3, 'years'],
  ],
  appliance: [
    ['Replace water filter', 6, 'months'],
    ['Clean condenser coils', 6, 'months'],
    ['Clean vent / lint duct', 1, 'years'],
  ],
  safety: [
    ['Test alarm', 6, 'months'],
    ['Replace battery', 1, 'years'],
    ['Recharge / inspect extinguisher', 1, 'years'],
  ],
  exterior: [
    ['Clean gutters', 6, 'months'],
    ['Inspect roof and flashing', 1, 'years'],
    ['Reseal deck', 2, 'years'],
  ],
  vehicle: [
    ['Oil change', 6, 'months'],
    ['Rotate tires', 6, 'months'],
    ['Replace cabin air filter', 1, 'years'],
  ],
  other: [['General inspection', 1, 'years']],
};

class ElmerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._hass = null;
    this._narrow = false;
    this._panel = null;

    this.tab = 'routines';
    this.filter = 'all';
    this.detail = null;     // { kind, id } — equipment detail replaces the list
    this.sheet = null;      // { kind, id, title } — the modal
    this.busy = {};         // routine ids with a completion in flight
    this.toast = null;
    this.data = null;
    this.error = null;
    this._unsub = null;
    this._toastTimer = null;
    this._pendingIcon = null;
    this._scrollTops = {};
    this._panelBox = null;

    this._onClick = this._onClick.bind(this);
    this._onKeydown = this._onKeydown.bind(this);
    this._onChange = this._onChange.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onThemeChange = this._onThemeChange.bind(this);
  }

  /* ---------------------------------------------------------- lifecycle -- */

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._connect();
    // Home Assistant's theme can change without the panel being recreated.
    this._applyTheme();
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = Boolean(value);
    if (this.data) this._render();
  }

  set panel(value) {
    this._panel = value;
  }

  connectedCallback() {
    const root = this.shadowRoot;
    if (!root.querySelector('style')) {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);

      // Two separate trees. The app is rebuilt on every render; the overlay
      // layer is not, because it holds the open form and rebuilding it would
      // throw away whatever is half-typed in it.
      const mount = document.createElement('div');
      mount.className = 'app';
      root.appendChild(mount);
      this._mount = mount;

      const layer = document.createElement('div');
      layer.className = 'layer';
      root.appendChild(layer);
      this._layer = layer;
    }
    root.addEventListener('click', this._onClick);
    root.addEventListener('change', this._onChange);
    // Capture, because blur does not bubble.
    root.addEventListener('blur', this._onBlur, true);
    // Keys are listened for on the window, not the shadow root. Opening a sheet
    // re-renders and destroys whatever had focus, so focus falls back to the
    // document body — outside the shadow root, where a listener on the root
    // would never see Escape.
    window.addEventListener('keydown', this._onKeydown, true);

    this._media = window.matchMedia('(prefers-color-scheme: dark)');
    this._media.addEventListener('change', this._onThemeChange);

    // The overlay is anchored to the window, so the panel has to tell it where
    // the panel actually is. Watching the host covers both ways that moves
    // inside Home Assistant — the window resizing and the sidebar collapsing —
    // because either one changes the host's own width.
    this._measurePanel();
    if (typeof ResizeObserver === 'function') {
      this._resize = new ResizeObserver(() => this._measurePanel());
      this._resize.observe(this);
    }

    this._render();
    if (this._hass && !this._unsub) this._connect();
  }

  disconnectedCallback() {
    const root = this.shadowRoot;
    root.removeEventListener('click', this._onClick);
    root.removeEventListener('change', this._onChange);
    root.removeEventListener('blur', this._onBlur, true);
    window.removeEventListener('keydown', this._onKeydown, true);
    if (this._media) this._media.removeEventListener('change', this._onThemeChange);
    if (this._resize) { this._resize.disconnect(); this._resize = null; }
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._unsubscribe();
  }

  /**
   * Record how far the panel sits from each edge of the window, so a sheet
   * fixed to the window can still be centred on the panel. Writing a custom
   * property changes nothing about the host's own box, so this cannot feed back
   * into the ResizeObserver that calls it.
   */
  _measurePanel() {
    const box = this.getBoundingClientRect();
    if (!box.width) return;                 // hidden; whatever is set still holds
    const left = Math.max(0, Math.round(box.left));
    const right = Math.max(0, Math.round(window.innerWidth - box.right));
    const key = `${left}:${right}`;
    if (key === this._panelBox) return;
    this._panelBox = key;
    this.style.setProperty('--panel-l', `${left}px`);
    this.style.setProperty('--panel-r', `${right}px`);
  }

  _unsubscribe() {
    // The subscription resolves to an unsubscribe function. If the element is
    // torn down before it resolves, awaiting the promise and then calling it is
    // what stops the connection leaking a subscription per panel visit.
    const pending = this._unsub;
    this._unsub = null;
    if (!pending) return;
    Promise.resolve(pending)
      .then((off) => typeof off === 'function' && off())
      .catch(() => {});
  }

  async _connect() {
    if (!this._hass || !this._hass.connection) return;
    this._unsub = this._hass.connection.subscribeMessage(
      (snapshot) => {
        this.error = null;
        this.data = snapshot;
        this._render();
      },
      { type: 'elmer/subscribe' },
    );
    try {
      await this._unsub;
    } catch (err) {
      this.error = err && err.message ? err.message : 'Could not reach Elmer.';
      this._render();
    }
  }

  _onThemeChange() {
    this._applyTheme();
  }

  /**
   * Follow Home Assistant's theme unless Elmer's own setting overrides it.
   *
   * `hass.themes.darkMode` is the authoritative answer when it is present —
   * somebody can pin Home Assistant to dark while their phone is in light mode,
   * and the panel should match the dashboard around it, not the OS.
   */
  /** The reader's text-size preference, as an attribute the stylesheet reads. */
  _applyTextSize() {
    const pref = (this.data && this.data.settings && this.data.settings.textSize) || 'default';
    if (pref === 'default') this.removeAttribute('data-text');
    else this.setAttribute('data-text', pref);
  }

  _applyTheme() {
    const pref = (this.data && this.data.settings && this.data.settings.theme) || 'system';
    let dark;
    if (pref === 'dark') dark = true;
    else if (pref === 'light') dark = false;
    else {
      const themes = this._hass && this._hass.themes;
      dark = themes && typeof themes.darkMode === 'boolean'
        ? themes.darkMode
        : Boolean(this._media && this._media.matches);
    }
    if (dark) this.setAttribute('data-theme', 'dark');
    else this.setAttribute('data-theme', 'light');
    // Whether this is a choice or a reflection matters to the stylesheet: only
    // a choice is allowed to stop reading Home Assistant's surface colours,
    // which carry HA's mode rather than the one that was asked for.
    if (pref === 'system') this.removeAttribute('data-pinned');
    else this.setAttribute('data-pinned', '');
    this._applyTextSize();
  }

  /* -------------------------------------------------------------- state -- */

  /** The shape the views read: raw data plus the integration's computed status. */
  get state() {
    const d = this.data;
    const rows = d.tasks
      .map((task) => ({
        task,
        state: d.computed.states[task.id] || { status: 'new', daysLeft: null, progress: 0, due: null },
        equipment: d.equipment.find((e) => e.id === task.equipmentId) || null,
      }))
      .sort(byUrgency);

    return {
      equipment: d.equipment,
      tasks: d.tasks,
      supplies: d.supplies,
      log: d.log,
      settings: d.settings,
      computed: d.computed,
      rows,
      filter: this.filter,
      busy: this.busy,
      version: (this._panel && this._panel.config && this._panel.config.version) || '—',
    };
  }

  /* ------------------------------------------------------------- render -- */

  _render() {
    if (!this._mount) return;

    // Keep the scroll position across a re-render, so ticking the fourth row of
    // a long list does not throw you back to the top.
    const scroller = this.shadowRoot.querySelector('.scroll');
    if (scroller) this._scrollTops[this._scrollKey()] = scroller.scrollTop;

    if (this.error) {
      this._mount.innerHTML = html`<div class="center">
        <div>${this.error}<br><br>Check that the Elmer integration is still set up, then reload this page.</div>
      </div>`;
      return;
    }
    if (!this.data) {
      this._mount.innerHTML = '<div class="center">Loading…</div>';
      return;
    }

    const state = this.state;
    const body = this.detail ? this._renderDetail(state) : this._renderTab(state);

    // The body is wrapped so the app grid always has exactly three children —
    // header, main, tabs. A view returns several siblings (banner, stats, pills,
    // scroller), and without the wrapper the grid's row template would depend on
    // which screen happened to be showing.
    this._mount.innerHTML =
      this._header(state)
      + this._tabs(state)
      + `<div class="main">${body}</div>`;

    this._syncOverlays(state);

    const next = this.shadowRoot.querySelector('.scroll');
    if (next) next.scrollTop = this._scrollTops[this._scrollKey()] || 0;

    // The tab row scrolls sideways on a narrow screen, so the selected tab has
    // to be brought into view or it can sit off the edge after a tab change.
    const selected = this.shadowRoot.querySelector('.tab[aria-selected="true"]');
    if (selected) {
      const bar = selected.parentElement;
      const left = selected.offsetLeft - (bar.clientWidth - selected.offsetWidth) / 2;
      bar.scrollLeft = Math.max(0, left);
    }

    if (this.sheet && !this._sheetFocused) {
      // Focus the dialog itself so Escape and a screen reader both land inside
      // it. On a wide screen the first field is focused instead, but never on a
      // phone — the keyboard sliding up would cover what you are filling in.
      const first = this._narrow
        ? null
        : this.shadowRoot.querySelector('.sheet input, .sheet select, .sheet textarea');
      (first || this.shadowRoot.querySelector('.sheet'))?.focus();
      this._sheetFocused = true;
    }
  }

  _scrollKey() {
    if (this.detail) return `${this.detail.kind}:${this.detail.id}`;
    return `${this.tab}:${this.filter}`;
  }

  /**
   * The header holds navigation state and nothing else.
   *
   * It used to carry an add button whose meaning changed with the screen, which
   * is a control that looks identical while doing something different each time
   * you reach for it. Adding now lives in a fixed corner button instead.
   */
  _header(state) {
    const back = this.detail;

    if (back) {
      const eq = back.kind === 'equipment'
        ? state.equipment.find((e) => e.id === back.id)
        : null;
      return html`<div class="header"><div class="headerinner">
        <button class="iconbtn" data-act="back" aria-label="Back">${raw(icon('back', 20))}</button>
        <div class="brand"><span class="title">${eq ? eq.name : 'Equipment'}</span></div>
        <div class="spacer"></div>
        ${raw(this._addButton())}
      </div></div>`;
    }

    // Home Assistant hides its sidebar on a narrow screen, so the panel has to
    // offer the way back to it.
    const menu = this._narrow
      ? `<button class="iconbtn" data-act="menu" aria-label="Open the Home Assistant menu">${icon('menu', 20)}</button>`
      : '';

    return html`<div class="header"><div class="headerinner">
      ${raw(menu)}
      <div class="brand">${raw(icon('mark', 21))}<span class="word">ELMER</span></div>
      <div class="spacer"></div>
      ${raw(this._addButton())}
    </div></div>`;
  }

  /**
   * The add button, in the header and labelled with what it adds.
   *
   * It carries its label rather than being a bare plus, which is what makes a
   * control whose action changes with the screen honest: "Add Routine" and
   * "Add Equipment" do not look like the same button. Screens with nothing to
   * add show none, and since it is last in the row nothing else shifts.
   */
  _addButton() {
    const add = this._addActionFor();
    if (!add) return '';
    return html`<button class="addbtn" data-act="${add.act}"${raw(add.id ? ` data-id="${esc(add.id)}"` : '')}
      title="${add.label}">${raw(icon('plus', 17))}<span>${add.label}</span></button>`;
  }

  _addActionFor() {
    if (this.detail && this.detail.kind === 'equipment') {
      return { act: 'add-routine', id: this.detail.id, label: 'Add Routine' };
    }
    if (this.tab === 'equipment') return { act: 'add-equipment', label: 'Add Equipment' };
    if (this.tab === 'parts') return { act: 'add-part', label: 'Add Part' };
    // A routine does not have to belong to anything — equipment is a blank
    // option on the form, and the store has always accepted a routine without
    // it. This used to be hidden until some equipment existed, which left a
    // fresh install with no way at all to write down "bleed the radiators"
    // without inventing a piece of equipment to hang it on.
    if (this.tab === 'routines') return { act: 'add-routine', label: 'Add Routine' };
    return null;
  }

  _renderTab(state) {
    switch (this.tab) {
      case 'equipment': return equipmentView(state);
      case 'parts': return partsView(state);
      case 'history': return historyView(state);
      case 'settings': return settingsView(state);
      default: return routinesView(state);
    }
  }

  _renderDetail(state) {
    if (this.detail.kind === 'equipment') return equipmentDetail(state, this.detail.id);
    return '<div class="center">—</div>';
  }

  /** One row, directly under the header, at every width and on every screen. */
  _tabs(state) {
    const overdue = state.computed.counts.overdue;
    // The bar spans the panel so its rule reaches both edges, but the tabs sit
    // in an inner column of the same measure as the content, so the first tab
    // starts exactly where the list below it does.
    return html`<nav class="tabs"><div class="tabsinner" role="tablist">${TABS.map(([key, label, ic]) => {
      const badge = key === 'routines' && overdue > 0
        ? `<span class="badge">${overdue > 99 ? '99+' : overdue}</span>`
        : '';
      return html`<button class="tab" role="tab" data-act="tab" data-value="${key}"
        aria-selected="${this.tab === key && !this.detail}">
        ${raw(icon(ic, 18))}<span>${label}</span>${raw(badge)}
      </button>`;
    })}</div></nav>`;
  }

  /**
   * Keep the overlays in step without rebuilding them.
   *
   * The sheet holds live form fields, so its markup is only regenerated when a
   * *different* sheet is wanted. Rebuilding it on every render — which a toast
   * expiring four seconds after an unrelated action is enough to trigger —
   * silently emptied whatever was being typed into it.
   */
  _syncOverlays(state) {
    const key = this.sheet
      ? [this.sheet.kind, this.sheet.id || '', this.sheet.equipmentId || '',
        (this.sheet.file && this.sheet.file.name) || ''].join('|')
      : '';

    if (key !== this._sheetKey) {
      this._sheetKey = key;
      this._sheetFocused = false;
      const existing = this._layer.querySelector('.scrim');
      if (existing) existing.remove();
      if (this.sheet) {
        this._measurePanel();
        const { title, body } = this._sheetContent(state);
        this._layer.insertAdjacentHTML('afterbegin', html`<div class="scrim" data-act="scrim">
          <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
            <header>
              <h2>${title}</h2>
              <button class="iconbtn" data-act="close" aria-label="Close">${raw(icon('x', 19))}</button>
            </header>
            <div class="inner">${raw(body)}</div>
          </div>
        </div>`);
      }
    }

    // The toast holds no input, so it is cheap to replace outright.
    const toast = this._layer.querySelector('.toast');
    if (toast) toast.remove();
    if (this.toast) {
      this._layer.insertAdjacentHTML('beforeend', html`<div class="toast"${raw(this.toast.tone ? ` data-tone="${esc(this.toast.tone)}"` : '')}>
        <span>${this.toast.text}</span>
        ${raw(this.toast.undo ? `<button data-act="undo" data-id="${esc(this.toast.undo)}">Undo</button>` : '')}
      </div>`);
    }
  }

  _sheetContent(state) {
    const s = this.sheet;
    switch (s.kind) {
      case 'equipment-form': {
        const eq = s.id ? state.equipment.find((e) => e.id === s.id) : null;
        return { title: eq ? `Edit ${eq.name}` : 'Add equipment', body: equipmentForm(state, eq) };
      }
      case 'routine-form': {
        const task = s.id ? state.tasks.find((t) => t.id === s.id) : null;
        return {
          title: task ? `Edit ${task.name}` : 'Add a routine',
          body: routineForm(state, task, s.equipmentId),
        };
      }
      case 'part-form': {
        const part = s.id ? state.supplies.find((p) => p.id === s.id) : null;
        return { title: part ? `Edit ${part.name}` : 'Add a part', body: partForm(state, part) };
      }
      case 'routine': {
        const task = state.tasks.find((t) => t.id === s.id);
        return { title: task ? task.name : 'Routine', body: logForm(state, s.id) };
      }
      case 'log':
        return { title: 'History entry', body: logDetail(state, s.id) };
      case 'templates':
        return { title: 'Suggested routines', body: this._templateBody(state, s.id) };
      case 'import':
        return { title: 'Import a backup', body: importForm(state, s.file) };
      default:
        return { title: 'Elmer', body: '' };
    }
  }

  _templateBody(state, equipmentId) {
    const eq = state.equipment.find((e) => e.id === equipmentId);
    const list = (eq && TEMPLATES[eq.category]) || TEMPLATES.other;
    return html`<div class="note" style="padding:8px 0 4px">These are typical for ${eq ? eq.name : 'this'}. Pick the ones that apply — every interval stays editable, and you can add your own instead.</div>
      <div class="card">${list.map((t, i) => html`<div class="row" style="cursor:default">
        <div class="body"><div class="title">${t[0]}</div>
          <div class="sub"><span class="txt">every ${t[1]} ${t[2]}</span></div></div>
        <input type="checkbox" name="tpl:${i}" checked style="width:22px;height:22px;accent-color:var(--accent)">
      </div>`)}</div>
      <div class="btnrow">
        <button class="btn" data-act="close">Not now</button>
        <button class="btn" data-variant="primary" data-act="save-templates" data-id="${equipmentId}">Add selected</button>
      </div>`;
  }

  /* ------------------------------------------------------------- events -- */

  _onKeydown(ev) {
    if (ev.key === 'Escape' && this.sheet) {
      ev.preventDefault();
      ev.stopPropagation();
      this._closeSheet();
      return;
    }
    // Rows are divs so they can hold their own buttons; this gives them the
    // keyboard behaviour a button would have had. composedPath is what reaches
    // the real target through the shadow boundary.
    if (ev.key === 'Enter' || ev.key === ' ') {
      const inner = ev.composedPath()[0];
      if (!inner || !inner.closest || !this.shadowRoot.contains(inner)) return;
      const target = inner.closest('[role="button"][data-act]');
      if (target) {
        ev.preventDefault();
        this._act(target.dataset.act, target);
      }
    }
  }

  _onClick(ev) {
    const el = ev.target.closest && ev.target.closest('[data-act]');
    if (!el) return;
    // The scrim is the whole overlay, so only a click on the backdrop itself
    // should dismiss — not one that lands on the sheet inside it.
    if (el.dataset.act === 'scrim' && ev.target !== el) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._act(el.dataset.act, el);
  }

  _onChange(ev) {
    const el = ev.target.closest && ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'set-theme') {
      this._apply([{ kind: 'settings.put', payload: { theme: el.value } }]);
      // Repaint immediately rather than waiting for the round trip, so the
      // switch feels like a switch.
      this.data.settings.theme = el.value;
      this._applyTheme();
    } else if (act === 'set-text') {
      this._apply([{ kind: 'settings.put', payload: { textSize: el.value } }]);
      // Repaint at the new size immediately rather than after the round trip.
      this.data.settings.textSize = el.value;
      this._applyTextSize();
    } else if (act === 'pick-part') {
      this._pickPart(el);
    } else if (act === 'pick-location') {
      // Reveal the new-location box only when there is a new location to type.
      const box = el.parentElement.querySelector('input[name="locationNew"]');
      if (box) {
        const adding = el.value === '__new__';
        box.style.display = adding ? '' : 'none';
        if (adding) box.focus();
        else box.value = '';
      }
    } else if (act === 'set-locations') {
      this._apply([{ kind: 'settings.put', payload: { showLocations: el.value === '1' } }]);
    } else if (act === 'set-soon') {
      const n = Math.max(0, Math.min(365, parseInt(el.value, 10) || 0));
      this._apply([{ kind: 'settings.put', payload: { dueSoonDays: n } }]);
    }
  }

  /** Capitalise a name when you leave the field, never as you type it. */
  _onBlur(ev) {
    const el = ev.target;
    if (el && el.dataset && 'titlecase' in el.dataset && el.value) {
      el.value = titleCase(el.value);
    }
  }

  _act(act, el) {
    const id = el.dataset.id;
    switch (act) {
      case 'menu':
        this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true }));
        return;
      case 'tab':
        this.tab = el.dataset.value;
        this.detail = null;
        this._render();
        return;
      case 'back':
        this.detail = null;
        this._render();
        return;
      case 'filter':
        // Tapping the active filter clears it, so the stat strip toggles.
        this.filter = this.filter === el.dataset.value ? 'all' : el.dataset.value;
        if (this.tab !== 'routines') { this.tab = 'routines'; this.detail = null; }
        this._render();
        return;
      case 'equipment':
        this.detail = { kind: 'equipment', id };
        this._render();
        return;
      case 'routine':
        this._openSheet({ kind: 'routine', id });
        return;
      case 'part':
        this._openSheet({ kind: 'part-form', id });
        return;
      case 'log':
        this._openSheet({ kind: 'log', id });
        return;
      case 'add-equipment':
        this._openSheet({ kind: 'equipment-form' });
        return;
      case 'add-routine':
        this._openSheet({ kind: 'routine-form', equipmentId: id || '' });
        return;
      case 'add-part':
        this._openSheet({ kind: 'part-form' });
        return;
      case 'edit-equipment':
        this._openSheet({ kind: 'equipment-form', id });
        return;
      case 'edit-routine':
        this._openSheet({ kind: 'routine-form', id });
        return;
      case 'pick-icon':
        this._pickIcon(el);
        return;
      case 'unpick-part':
        this._unpickPart(el);
        return;
      case 'close':
      case 'scrim':
        this._closeSheet();
        return;
      case 'complete':
        this._complete(id);
        return;
      case 'undo':
        this._undo(id);
        return;
      case 'stock':
        this._apply([{ kind: 'part.adjust', payload: { id, delta: Number(el.dataset.delta) } }]);
        return;
      case 'save-equipment':
        this._saveEquipment(id);
        return;
      case 'save-routine':
        this._saveRoutine(id);
        return;
      case 'save-part':
        this._savePart(id);
        return;
      case 'save-log':
        this._saveLog(id);
        return;
      case 'save-templates':
        this._saveTemplates(id);
        return;
      case 'delete-equipment':
        this._deleteEquipment(id);
        return;
      case 'delete-routine':
        this._confirmDelete('routine.delete', id, 'Routine deleted');
        return;
      case 'delete-part':
        this._confirmDelete('part.delete', id, 'Part deleted');
        return;
      case 'export':
        this._export();
        return;
      case 'import':
        this._pickFile();
        return;
      case 'confirm-import':
        this._import();
        return;
      default:
    }
  }

  /**
   * Add the chosen part to the routine being edited.
   *
   * The row is appended rather than the sheet re-rendered: a re-render would
   * rebuild every field and throw away whatever else is half-typed in the form.
   * The picker then drops the option, so the same part cannot be added twice.
   */
  _pickPart(select) {
    const id = select.value;
    if (!id) return;
    const supply = this.data.supplies.find((p) => p.id === id);
    const list = this.shadowRoot.querySelector('.sheet .partlist');
    if (!supply || !list) return;
    list.insertAdjacentHTML('beforeend', partRow(supply, 1));
    this._refreshPartOptions();
  }

  _unpickPart(button) {
    const row = button.closest('.partrow');
    if (row) row.remove();
    this._refreshPartOptions();
  }

  /** Rebuild the picker from whichever parts are not on the routine now. */
  _refreshPartOptions() {
    const sheet = this.shadowRoot.querySelector('.sheet');
    const select = sheet && sheet.querySelector('select[data-act="pick-part"]');
    if (!select) return;
    const used = [...sheet.querySelectorAll('.partrow')].map((r) => ({ supplyId: r.dataset.part }));
    select.innerHTML = partOptions(this.state, used);
    select.value = '';
  }

  _pickIcon(el) {
    const wrap = el.parentElement;
    for (const b of wrap.querySelectorAll('[data-act="pick-icon"]')) {
      b.setAttribute('aria-pressed', String(b === el));
    }
    const hidden = this.shadowRoot.querySelector('.sheet input[name="icon"]');
    if (hidden) hidden.value = el.dataset.value;
  }

  _openSheet(sheet) {
    // A toast about the last thing you did is not about the form you have just
    // opened, and it would sit over the form's buttons.
    if (this.toast) {
      this.toast = null;
      if (this._toastTimer) clearTimeout(this._toastTimer);
    }
    this.sheet = sheet;
    this._sheetFocused = false;
    this._render();
  }

  _closeSheet() {
    this.sheet = null;
    this._sheetFocused = false;
    this._render();
  }

  /* --------------------------------------------------------------- forms -- */

  /** Read the open sheet's fields by name. */
  _fields() {
    const out = {};
    const sheet = this.shadowRoot.querySelector('.sheet');
    if (!sheet) return out;
    for (const el of sheet.querySelectorAll('[name]')) {
      out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out;
  }

  async _saveEquipment(id) {
    const f = this._fields();
    const name = (f.name || '').trim();
    if (!name) return this._flash('Give it a name first.', 'error');

    const existing = id ? this.data.equipment.find((e) => e.id === id) : null;
    const record = {
      id: id || uid('eq'),
      name: titleCase(name),
      // Either the picker or the new-location box, depending on which the form
      // is showing; "__new__" means the box.
      location: titleCase(
        (f.locationPick && f.locationPick !== '__new__' ? f.locationPick : f.locationNew || '').trim(),
      ),
      category: f.category || '',
      brand: (f.brand || '').trim(),
      model: (f.model || '').trim(),
      serial: (f.serial || '').trim(),
      partNumber: (f.partNumber || '').trim(),
      installedOn: f.installedOn || null,
      purchasedFrom: (f.purchasedFrom || '').trim(),
      phone: (f.phone || '').trim(),
      email: (f.email || '').trim(),
      notes: f.notes || '',
      icon: f.icon || '',
      // Carried through rather than rebuilt: the panel has no editor for the
      // replacement-parts links, and a save must not quietly drop them.
      parts: existing ? existing.parts || [] : [],
    };

    const isNew = !id;
    await this._apply([{ kind: 'equipment.put', payload: record }]);
    this._closeSheet();

    // A brand new piece of equipment with a category has suggestions worth
    // offering, so the app is useful before anybody types an interval.
    if (isNew && record.category && TEMPLATES[record.category]) {
      this._openSheet({ kind: 'templates', id: record.id });
    } else {
      this.detail = { kind: 'equipment', id: record.id };
      this._render();
    }
  }

  async _saveRoutine(id) {
    const f = this._fields();
    const name = (f.name || '').trim();
    if (!name) return this._flash('Give the routine a name first.', 'error');

    const count = Math.max(1, parseInt(f.intervalCount, 10) || 1);
    const partsUsed = [];
    for (const [key, value] of Object.entries(f)) {
      if (!key.startsWith('part:')) continue;
      const qty = parseInt(value, 10) || 0;
      if (qty > 0) partsUsed.push({ supplyId: key.slice(5), quantity: qty });
    }

    const record = {
      id: id || uid('task'),
      name: titleCase(name),
      equipmentId: f.equipmentId || null,
      intervalCount: count,
      intervalUnit: f.intervalUnit || 'months',
      lastDone: f.lastDone || null,
      partsUsed,
    };
    await this._apply([{ kind: 'routine.put', payload: record }]);
    this._closeSheet();
  }

  async _savePart(id) {
    const f = this._fields();
    const name = (f.name || '').trim();
    if (!name) return this._flash('Give the part a name first.', 'error');
    const record = {
      id: id || uid('sup'),
      name: titleCase(name),
      quantity: Math.max(0, parseInt(f.quantity, 10) || 0),
      reorderAt: Math.max(0, parseInt(f.reorderAt, 10) || 0),
      partNumber: (f.partNumber || '').trim(),
      purchasedFrom: (f.purchasedFrom || '').trim(),
      notes: f.notes || '',
      updatedAt: Date.now(),
    };
    await this._apply([{ kind: 'part.put', payload: record }]);
    this._closeSheet();
  }

  async _saveTemplates(equipmentId) {
    const f = this._fields();
    const eq = this.data.equipment.find((e) => e.id === equipmentId);
    const list = (eq && TEMPLATES[eq.category]) || TEMPLATES.other;
    const ops = [];
    list.forEach((t, i) => {
      if (!f[`tpl:${i}`]) return;
      ops.push({
        kind: 'routine.put',
        payload: {
          id: uid('task'),
          name: t[0],
          equipmentId,
          intervalCount: t[1],
          intervalUnit: t[2],
          lastDone: null,
          partsUsed: [],
        },
      });
    });
    if (ops.length) await this._apply(ops);
    this._closeSheet();
    this.detail = { kind: 'equipment', id: equipmentId };
    this._render();
  }

  async _saveLog(taskId) {
    const f = this._fields();
    const used = [];
    for (const [key, value] of Object.entries(f)) {
      if (!key.startsWith('part:')) continue;
      const qty = parseInt(value, 10) || 0;
      if (qty > 0) used.push({ supplyId: key.slice(5), quantity: qty });
    }
    this._closeSheet();
    await this._complete(taskId, {
      doneOn: f.doneOn || todayIso(),
      notes: f.notes || '',
      cost: f.cost || '',
      used,
    });
  }

  async _deleteEquipment(id) {
    const eq = this.data.equipment.find((e) => e.id === id);
    const n = this.data.tasks.filter((t) => t.equipmentId === id).length;
    const warning = n
      ? `Delete ${eq ? eq.name : 'this'} and its ${n} ${n === 1 ? 'routine' : 'routines'}? History is kept.`
      : `Delete ${eq ? eq.name : 'this'}?`;
    if (!window.confirm(warning)) return;
    await this._apply([{ kind: 'equipment.delete', payload: { id } }]);
    this.sheet = null;
    this.detail = null;
    this._flash('Deleted');
  }

  async _confirmDelete(kind, id, message) {
    if (!window.confirm('Delete this? It cannot be undone.')) return;
    await this._apply([{ kind, payload: { id } }]);
    this.sheet = null;
    this._flash(message);
  }

  /* ------------------------------------------------------------ the wire -- */

  async _apply(ops) {
    try {
      await this._hass.connection.sendMessagePromise({ type: 'elmer/apply', ops });
      return true;
    } catch (err) {
      this._flash(this._reason(err, 'Could not save that.'), 'error');
      return false;
    }
  }

  /**
   * Mark a routine done.
   *
   * The server does the arithmetic — what the routine consumes, what is actually
   * on the shelf, and the history entry — in one step, so stock and history
   * cannot drift apart. The row is disabled while it is in flight so a double
   * tap cannot log it twice.
   */
  async _complete(taskId, extra = {}) {
    if (this.busy[taskId]) return;
    this.busy[taskId] = true;
    this._render();

    const task = this.data.tasks.find((t) => t.id === taskId);
    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: 'elmer/complete',
        taskId,
        doneOn: extra.doneOn || null,
        notes: extra.notes || '',
        cost: extra.cost || '',
        used: extra.used || null,
      });
      const short = (shortName) => (shortName.length > 28 ? `${shortName.slice(0, 27)}…` : shortName);
      this._flash(`${short(task ? task.name : 'Done')} marked done`, null, res && res.entry && res.entry.id);
    } catch (err) {
      this._flash(this._reason(err, 'Could not mark that done.'), 'error');
    } finally {
      delete this.busy[taskId];
      this._render();
    }
  }

  async _undo(logId) {
    try {
      await this._hass.connection.sendMessagePromise({ type: 'elmer/undo', logId });
      this.sheet = null;
      this._flash('Undone');
    } catch (err) {
      this._flash(this._reason(err, 'Could not undo that.'), 'error');
    }
  }

  _reason(err, fallback) {
    if (!err) return fallback;
    if (err.code === 'not_loaded') return 'Elmer is not set up in Home Assistant.';
    return err.message || fallback;
  }

  _flash(text, tone = null, undoId = null) {
    this.toast = { text, tone, undo: undoId };
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast = null;
      this._render();
    }, tone === 'error' ? 6000 : 4000);
    this._render();
  }

  /* ------------------------------------------------------------- backups -- */

  /**
   * Export through the browser rather than writing a file on the server.
   *
   * It is the one route that works identically at home and on a phone over Nabu
   * Casa, and the copy lands where the person asked for a download to go rather
   * than somewhere in the config folder they then have to go and fetch.
   */
  _export() {
    const payload = {
      version: 1,
      equipment: this.data.equipment,
      tasks: this.data.tasks,
      supplies: this.data.supplies,
      log: this.data.log,
      settings: this.data.settings,
      exportedAt: Date.now(),
      exportedBy: 'elmer-ha',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `elmer-${this.data.computed.today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._flash('Copy exported');
  }

  /** Read the file here in the browser, so nothing has to be put on the server
   *  first — the same reason export downloads rather than writing a path. */
  _pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        this._flash('That file is not valid JSON.', 'error');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this._flash("That does not look like an Elmer backup.", 'error');
        return;
      }
      const counts = {
        equipment: countOf(parsed.equipment),
        routines: countOf(parsed.tasks),
        parts: countOf(parsed.supplies),
        history: countOf(parsed.log),
      };
      if (!counts.equipment && !counts.routines && !counts.parts && !counts.history) {
        this._flash('There is nothing in that file to import.', 'error');
        return;
      }
      // Show what was found and ask how to bring it in, rather than acting on a
      // file chooser's change event — replacing is not undoable.
      this._openSheet({ kind: 'import', file: { name: file.name, data: parsed, counts } });
    });
    input.click();
  }

  async _import() {
    const sheet = this.sheet;
    if (!sheet || sheet.kind !== 'import') return;
    const mode = this._fields().mode || 'merge';

    if (mode === 'replace') {
      const n = this.data.log.length;
      const warn = `Replace everything in Elmer with ${sheet.file.name}?\n\n`
        + `This discards what is here now, including ${n} history ${n === 1 ? 'entry' : 'entries'},`
        + ' and cannot be undone.';
      if (!window.confirm(warn)) return;
    }

    try {
      const res = await this._hass.connection.sendMessagePromise({
        type: 'elmer/import',
        data: sheet.file.data,
        merge: mode === 'merge',
      });
      this._closeSheet();
      const c = res && res.counts ? res.counts : sheet.file.counts;
      this._flash(`Imported ${c.equipment} equipment, ${c.routines} routines, ${c.parts} parts`);
    } catch (err) {
      this._flash(this._reason(err, 'Could not import that file.'), 'error');
    }
  }
}

function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

const RANK = { overdue: 0, due: 1, new: 2, ok: 3 };

function byUrgency(a, b) {
  const rank = (RANK[a.state.status] ?? 9) - (RANK[b.state.status] ?? 9);
  if (rank !== 0) return rank;
  if (a.state.daysLeft == null) return 1;
  if (b.state.daysLeft == null) return -1;
  return a.state.daysLeft - b.state.daysLeft;
}

if (!customElements.get('elmer-panel')) {
  customElements.define('elmer-panel', ElmerPanel);
}
