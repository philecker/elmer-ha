// Elmer's visual system, as a panel that lives inside Home Assistant.
//
// Three rules shape this file.
//
// 1. **The chrome never moves.** A header and one tab row, in the same place at
//    every width, on every screen. Everything else — the stat strip, the filter
//    pills, the lists — is page content that scrolls. An earlier version pinned
//    the stats and pills as chrome and moved the tabs from the bottom of a phone
//    to the top of a desktop, which meant the furniture rearranged itself as you
//    moved around. It doesn't now.
//
// 2. **Surfaces come from Home Assistant.** Backgrounds, text, dividers and card
//    geometry read HA's own custom properties, so Elmer sits inside whatever
//    theme is running rather than painting its own panel on top of it. Elmer's
//    values are the fallbacks, used when a property is missing.
//
// 3. **Status colour is Elmer's.** Overdue, due and fine are a traffic light,
//    and they have to mean the same thing in every theme — so they do not follow
//    the theme's accent. They are exposed as --elmer-* for anyone who wants to
//    override them deliberately.
//
// It all lives in a shadow root, so none of HA's styles reach in and none of
// these leak out; the tokens are therefore defined on :host.

export const CSS = `
:host {
  /* --- surfaces, from Home Assistant where it offers them --------------- */
  --paper: var(--primary-background-color, #f1f3f2);
  --surface: var(--card-background-color, #ffffff);
  --surface-2: var(--secondary-background-color, #f8faf9);
  --ink: var(--primary-text-color, #16211e);
  --ink-2: var(--secondary-text-color, #4a5a56);
  --line: var(--divider-color, #dee5e2);

  /* No HA equivalent: a subtle fill and a stronger rule, derived from what
     the theme did give us so they track it. */
  --surface-3: color-mix(in srgb, var(--ink) 6%, var(--surface));
  --line-strong: color-mix(in srgb, var(--ink) 20%, var(--surface));
  --ink-3: color-mix(in srgb, var(--ink-2) 72%, var(--surface));

  /* --- Elmer's own, overridable in a theme ------------------------------ */
  --accent: var(--elmer-accent, #0f5c4e);
  --accent-hover: var(--elmer-accent-hover, #0b4a3f);
  --accent-ink: var(--elmer-accent-text, #ffffff);
  --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--surface));

  --brass: var(--elmer-due-color, #96670c);
  --brass-soft: color-mix(in srgb, var(--brass) 13%, var(--surface));
  --rust: var(--elmer-overdue-color, #9c3626);
  --rust-soft: color-mix(in srgb, var(--rust) 12%, var(--surface));

  /* --- card geometry, from HA ------------------------------------------- */
  --r-lg: var(--ha-card-border-radius, 12px);
  --r-md: 10px;
  --r-sm: 7px;
  --card-border: var(--ha-card-border-color, var(--line));
  /* The modal's edge, matched on contrast rather than on lightness: a
     near-black line that reads as definition on a dark sheet reads as a hard
     frame on a white one. Mixed from the sheet's own ink and paper rather than
     written as a hex, because the sheet's paper is whatever theme is running —
     a fixed grey is only matched against the one theme it was measured on, and
     drifts on every other. 19% here and 15% on dark both land near 1.47:1,
     the two percentages differing because contrast is not linear in lightness. */
  --modal-border: var(--elmer-modal-border, color-mix(in srgb, var(--ink) 19%, var(--paper)));
  --card-shadow: var(--ha-card-box-shadow, none);

  --display: "Avenir Next", Avenir, system-ui, sans-serif;
  --body: var(--paper-font-body1_-_font-family,
    -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;

  /* One knob for the whole interface. --ui-base is set by screen width,
     because a phone is held at arm's length and a monitor is not; --ui-user is
     the reader's own preference on top. Every type size, icon and the boxes
     that hold them are multiplied by the product, so nothing is left behind at
     the old size and nothing clips when the text grows. */
  --ui-base: 1;
  --ui-user: 1;
  --ui-scale: calc(var(--ui-base) * var(--ui-user));

  /* The tab row sits one step above everything else. These are the five places
     you navigate from and they are read at a glance, not studied, so at the
     body's size they came out looking like a caption. 1.12 is exactly the
     "large" step of the text-size setting below, so the tabs now start where
     large used to put them — and because the step is folded into the tabs' own
     --ui-scale rather than written into a font-size, the label, the icon, the
     badge and the 46px tap target all move together, and every step of the
     setting still moves them from there. */
  --tab-bump: 1.12;

  --gutter: 14px;
  --content: 820px;
  /* A tab's own padding, which must stay at or below --gutter: the tab row is
     inset by the difference so a tab's label lands on the content's left edge,
     and a larger value would want negative padding, which clamps to zero and
     silently breaks the alignment. */
  --tab-pad: 10px;
  --header-h: calc(52px * var(--ui-scale));
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);

  color-scheme: light;
  display: block;
  position: relative;   /* the containing block for the overlay layer */
  height: 100%;
  font-family: var(--body);
  color: var(--ink);
  background: var(--paper);
  -webkit-font-smoothing: antialiased;
}

/* Dark, while still following Home Assistant: HA's own values where it offers
   them, Elmer's where it does not. */
:host([data-theme="dark"]) {
  color-scheme: dark;
  --paper: var(--primary-background-color, #101413);
  --surface: var(--card-background-color, #181d1c);
  --surface-2: var(--secondary-background-color, #1e2523);
  --ink: var(--primary-text-color, #e9efec);
  --ink-2: var(--secondary-text-color, #a2b0ac);
  --line: var(--divider-color, #2a3230);

  --accent: var(--elmer-accent, #4fbfa3);
  --accent-hover: var(--elmer-accent-hover, #62d0b4);
  --accent-ink: var(--elmer-accent-text, #08201b);
  --brass: var(--elmer-due-color, #e0ac4e);
  --rust: var(--elmer-overdue-color, #e07b65);
  --modal-border: var(--elmer-modal-border, color-mix(in srgb, var(--ink) 15%, var(--paper)));
}

/* --- the reader's own choice overrides the theme ------------------------ */

/* Surfaces come from Home Assistant (rule 2) only for as long as Elmer is
   following it. Choosing Light or Dark in settings says the opposite: HA's
   --primary-background-color and friends carry HA's mode, so reading them
   while pinned to the other one is how "Light" used to leave the panel dark —
   the attribute flipped, the accents flipped, and every surface stayed put.
   Pinned, Elmer paints its own palette. A deliberate --elmer-* override is
   still honoured, because that one is about Elmer rather than about HA. */
:host([data-pinned][data-theme="light"]) {
  color-scheme: light;
  --paper: #f1f3f2;
  --surface: #ffffff;
  --surface-2: #f8faf9;
  --ink: #16211e;
  --ink-2: #4a5a56;
  --line: #dee5e2;
  --card-border: var(--line);
}
:host([data-pinned][data-theme="dark"]) {
  color-scheme: dark;
  --paper: #101413;
  --surface: #181d1c;
  --surface-2: #1e2523;
  --ink: #e9efec;
  --ink-2: #a2b0ac;
  --line: #2a3230;
  --card-border: var(--line);
}

* { box-sizing: border-box; }

/* Every glyph carries its intended size as --ic and is scaled from there, so
   icons grow with the text instead of sitting stranded at their old size. */
.ic {
  flex: none;
  width: calc(var(--ic, 20px) * var(--ui-scale));
  height: calc(var(--ic, 20px) * var(--ui-scale));
}

/* ============================================================
   Chrome — header, tabs. Identical at every width, on every screen.
   ============================================================ */

.app {
  /* The app has to end where the window does, or nothing inside it scrolls.
     height:100% only works when whatever holds the panel has a height of its
     own, and Home Assistant does not always give a custom panel one; when it
     does not, 100% computes to auto, the app grows to the length of the list,
     and the *document* scrolls instead, taking the header and tabs with it.

     So the height is measured from the window rather than inherited: the panel
     records its own distance from the top of the window in --panel-t and the
     rest is what is left. It lives here rather than on :host because a rule in
     the document that targets the host element wins over :host regardless of
     specificity — and both Home Assistant and the harness set a height on the
     panel that way. Nothing outside the shadow root can reach .app.

     max-height keeps it honest when the panel *is* given a height: a
     percentage against an auto-height host resolves to none, so it only binds
     in the case where there is a real height to be bound by. */
  height: calc(100dvh - var(--panel-t, 0px));
  max-height: 100%;
  display: grid;
  /* minmax(0, 1fr), not 1fr: a grid item floors at its min-content width, so
     the scrolling tab row would otherwise widen the whole column to fit every
     tab and push the panel sideways instead of scrolling. */
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto 1fr;
  background: var(--paper);
  overflow: hidden;
}
.app > * { min-width: 0; }

.header { grid-row: 1; }
.tabs { grid-row: 2; }
.main { grid-row: 3; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.main > .scroll { flex: 1 1 auto; min-height: 0; }

.header {
  height: var(--header-h);
  background: var(--surface);
  position: relative;
  z-index: 4;
}
/* The bar spans the panel, its contents sit in the content's column — so the
   brand lines up with the list's left edge and the add button with its right,
   instead of being stranded in the far corners of a wide window. */
.headerinner {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  max-width: var(--content);
  margin: 0 auto;
  padding: 0 calc(var(--gutter) + var(--safe-r)) 0 calc(var(--gutter) + var(--safe-l));
}
/* A round icon button carries its own 10px of air around a 20px glyph, so the
   leading one is pulled back by that much to put the glyph on the gutter. */
.headerinner > .iconbtn:first-child { margin-left: -10px; }

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
  min-width: 0;
}
.brand .word {
  font-family: var(--display);
  font-weight: 600;
  font-size: calc(15px * var(--ui-scale));
  letter-spacing: 0.1em;
  color: var(--ink);
  transform: translateY(0.5px);
}
/* On a detail screen the title replaces the wordmark; it is a name, not a mark. */
.brand .title {
  font-size: calc(15.5px * var(--ui-scale));
  font-weight: 650;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spacer { flex: 1 1 auto; }

.iconbtn {
  flex: none;
  width: calc(40px * var(--ui-scale));
  height: calc(40px * var(--ui-scale));
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.iconbtn:hover { background: var(--surface-3); color: var(--ink); }
.iconbtn:active { transform: scale(0.94); }

/* ---------- tab row ---------- */

.tabs {
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  z-index: 3;
}
/* The same measure and gutter as .pad, so the first tab's label starts on the
   same vertical as the content beneath it. */
.tabsinner {
  display: flex;
  gap: 2px;
  max-width: var(--content);
  margin: 0 auto;
  padding: 0 calc(var(--gutter) - var(--tab-pad) + var(--safe-r))
           0 calc(var(--gutter) - var(--tab-pad) + var(--safe-l));
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  /* A sideways swipe here is only ever a sideways swipe. Without pan-x the
     browser keeps the vertical gesture alive too, so dragging the tabs left
     and right also drags the page under them and rubber-bands it; contain
     stops the scroll chaining to the page once the row hits either end. */
  touch-action: pan-x;
  overscroll-behavior: contain;
}
.tabsinner::-webkit-scrollbar { display: none; }

.tab {
  /* Everything inside a tab is measured against this, so the step up applies
     once, here, instead of being written into each size separately. */
  --ui-scale: calc(var(--ui-base) * var(--ui-user) * var(--tab-bump));
  flex: 0 0 auto;
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: none;
  color: var(--ink-3);
  font: inherit;
  font-size: calc(11.5px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  /* 46px, so a thumb can hit it as easily as a mouse. */
  min-height: calc(46px * var(--ui-scale));
  /* Tight enough that four of the five fit on a 390px phone; the row scrolls
     for the last one, and the half-visible tab is what signals that it does. */
  padding: 0 var(--tab-pad);
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  /* The underline is drawn by a child so it can sit on the row's border. */
}
.tab .ic { opacity: 0.85; }
.tab[aria-selected="true"] { color: var(--accent); }
.tab[aria-selected="true"] .ic { opacity: 1; }
.tab::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
}
.tab[aria-selected="true"]::after { background: var(--accent); }
.tab:hover:not([aria-selected="true"]) { color: var(--ink-2); }

.tab .badge {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--rust);
  color: #fff;
  font-family: var(--mono);
  font-size: calc(9.5px * var(--ui-scale));
  font-weight: 700;
  line-height: 17px;
  text-align: center;
  letter-spacing: 0;
}

/* ============================================================
   Content
   ============================================================ */

.scroll {
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
  /* Hold the scrollbar's width whether or not there is anything to scroll.
     Without it the track appears only on the long tabs, and every move between
     a long list and a short one shifts the content sideways by its width.

     both-edges, not plain stable: the content column is centred, so reserving
     the gutter on one side only moves the centre line half a scrollbar to the
     left and the content stops lining up with the header and the tab row above
     it, which do not have a gutter. Reserving it on both sides keeps the centre
     where it was. */
  scrollbar-gutter: stable both-edges;
}
.scroll::-webkit-scrollbar { width: 9px; }
.scroll::-webkit-scrollbar-track { background: transparent; }
.scroll::-webkit-scrollbar-thumb {
  background: var(--line-strong);
  border-radius: 9px;
  border: 3px solid transparent;
  background-clip: content-box;
}

.pad {
  padding: 12px calc(var(--gutter) + var(--safe-r))
           calc(28px + var(--safe-b)) calc(var(--gutter) + var(--safe-l));
  max-width: var(--content);
  margin: 0 auto;
}

/* ---------- alert banner ---------- */

.alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 11px 13px;
  min-height: calc(44px * var(--ui-scale));
  border-radius: var(--r-md);
  background: var(--rust-soft);
  color: var(--rust);
  border: 1px solid color-mix(in srgb, var(--rust) 24%, transparent);
  font-size: calc(12px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
  text-align: left;
}
.alert .ic { flex: none; }
.alert span { overflow: hidden; text-overflow: ellipsis; }

/* ---------- filter row ----------
   Five equal buttons filling the measure, each tinted by what it counts, so
   the colour of the control says the same thing as the number inside it.
   One --tone per button drives the fill, the border, the figure and the
   selected ring, which is why there is only one rule for each of them. */

.pills {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 7px;
  margin: 0 0 12px;
}

.pill {
  --tone: var(--ink-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* Grid items are min-width:auto by default, so without this the longest
     label ("Never done") sets the column width and the row runs off a phone. */
  min-width: 0;
  min-height: calc(58px * var(--ui-scale));
  padding: 7px 3px;
  border-radius: var(--r-md);
  border: 1px solid color-mix(in srgb, var(--tone) 26%, transparent);
  background: color-mix(in srgb, var(--tone) 10%, var(--surface));
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.pill:active { transform: scale(0.97); }

.pill[data-tone="overdue"] { --tone: var(--rust); }
.pill[data-tone="due"] { --tone: var(--brass); }
.pill[data-tone="ok"] { --tone: var(--accent); }
.pill[data-tone="new"] { --tone: var(--ink-3); }
.pill[data-tone="all"] { --tone: var(--ink-2); }

/* Nothing in it, nothing to shout about: a zero drops back to neutral rather
   than painting an empty bucket red. The button stays, because one vanishing
   from the row would shift the other four. */
.pill[data-zero] { --tone: var(--ink-3); opacity: 0.62; }

.pill .n {
  font-family: var(--mono);
  font-size: calc(17px * var(--ui-scale));
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--tone);
}
.pill .l {
  font-size: calc(9px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  text-align: center;
  line-height: 1.2;
}

/* A ring drawn inside the box, so selecting one does not change its size and
   nudge the other four. */
.pill[aria-pressed="true"] {
  box-shadow: inset 0 0 0 2px var(--tone);
  background: color-mix(in srgb, var(--tone) 17%, var(--surface));
  opacity: 1;
}
.pill[aria-pressed="true"] .l { color: var(--tone); }

/* ---------- section label ---------- */

.label {
  font-size: calc(10px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin: 18px 2px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.label::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.label:first-child { margin-top: 4px; }

/* ---------- cards & rows ---------- */

.card {
  background: var(--surface);
  border: 1px solid var(--card-border);
  border-radius: var(--r-lg);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  min-height: calc(60px * var(--ui-scale));
  border-bottom: 1px solid var(--line);
  background: none;
  border-left: 0; border-right: 0; border-top: 0;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.row:last-child { border-bottom: 0; }
.row:hover { background: var(--surface-2); }
.row:active { background: var(--surface-3); }

.row .body { flex: 1 1 auto; min-width: 0; }
.row .title {
  font-size: calc(14.5px * var(--ui-scale));
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row .sub {
  font-size: calc(11.5px * var(--ui-scale));
  color: var(--ink-3);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
/* The relative time never wraps — it is short and it is the thing being read.
   The equipment name beside it truncates instead, so every row is one height. */
.row .sub b { font-weight: 600; color: var(--ink-2); flex: none; white-space: nowrap; }
.row .sub .dot { flex: none; opacity: 0.45; }
.row .sub .txt {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row .sub[data-tone="overdue"] b { color: var(--rust); }
.row .sub[data-tone="due"] b { color: var(--brass); }

.glyph {
  flex: none;
  width: calc(36px * var(--ui-scale));
  height: calc(36px * var(--ui-scale));
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--surface-3);
  color: var(--ink-2);
}

/* ---------- cycle meter — signature element ---------- */

.meter {
  flex: none;
  position: relative;
  width: calc(34px * var(--ui-scale));
  height: calc(34px * var(--ui-scale));
}
/* The ring is drawn at a fixed 34 in its own coordinates, so the box scales
   and the drawing follows it rather than being re-measured. */
.meter svg { transform: rotate(-90deg); display: block; width: 100%; height: 100%; }
.meter .track { stroke: var(--line); }
.meter .fill {
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.meter[data-status="ok"] .fill { stroke: var(--accent); }
.meter[data-status="due"] .fill { stroke: var(--brass); }
.meter[data-status="overdue"] .fill { stroke: var(--rust); }
.meter[data-status="new"] .fill { stroke: var(--ink-3); }
.meter .pip {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: calc(9px * var(--ui-scale));
  font-weight: 600;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
.meter[data-status="overdue"] .pip { color: var(--rust); }
.meter[data-status="due"] .pip { color: var(--brass); }

/* ---------- tick ---------- */

.tick {
  flex: none;
  width: calc(34px * var(--ui-scale));
  height: calc(34px * var(--ui-scale));
  border-radius: 50%;
  border: 1.5px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-3);
  display: grid;
  place-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.tick:hover { border-color: var(--accent); color: var(--accent); }
.tick:active { transform: scale(0.9); }
.tick[data-busy] { opacity: 0.4; pointer-events: none; }

/* ---------- stock quantity ---------- */

.qty {
  flex: none;
  min-width: calc(34px * var(--ui-scale));
  height: calc(34px * var(--ui-scale));
  padding: 0 7px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-family: var(--mono);
  font-size: calc(13px * var(--ui-scale));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--surface-3);
  color: var(--ink-2);
}
.qty[data-tone="out"] { background: var(--rust-soft); color: var(--rust); }
.qty[data-tone="low"] { background: var(--brass-soft); color: var(--brass); }

.stepper { display: flex; align-items: center; gap: 2px; flex: none; }
.stepper .iconbtn {
  width: calc(34px * var(--ui-scale));
  height: calc(34px * var(--ui-scale));
  border: 1px solid var(--card-border);
  border-radius: var(--r-sm);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: calc(10.5px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: var(--r-sm);
  background: var(--surface-3);
  color: var(--ink-3);
}
.tag[data-tone="overdue"] { background: var(--rust-soft); color: var(--rust); }
.tag[data-tone="due"] { background: var(--brass-soft); color: var(--brass); }
.tag[data-tone="ok"] { background: var(--accent-soft); color: var(--accent); }

/* ---------- buttons ---------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: calc(42px * var(--ui-scale));
  padding: 0 16px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: calc(14px * var(--ui-scale));
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.btn:hover { background: var(--surface-2); }
.btn:active { transform: scale(0.985); }
/* A .btn is usually a <button>; the one in Support is a link out, and a link
   arrives underlined. */
a.btn { text-decoration: none; }

/* Prose in a card. Not .note, which is pre-wrap for text somebody typed and
   would keep this block's own source indentation. */
.support { padding: 2px 12px 14px; }
.support p {
  margin: 10px 0 0;
  font-size: calc(13px * var(--ui-scale));
  color: var(--ink-2);
  line-height: 1.55;
}
.support .btn { margin-top: 14px; }

.btn[data-variant="primary"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.btn[data-variant="primary"]:hover { background: var(--accent-hover); }
.btn[data-variant="danger"] { color: var(--rust); border-color: var(--rust); }
.btn[disabled] { opacity: 0.45; pointer-events: none; }
.btn[data-full] { width: 100%; }

.btnrow { display: flex; gap: 8px; margin-top: 14px; }
.btnrow .btn { flex: 1 1 0; min-width: 0; }

/* ---------- the add button ----------
   In the header, carrying the name of what it adds. A bare plus in this slot
   would look the same on every screen while doing something different each
   time; the label is what makes it honest. It is last in the row, so the
   screens with nothing to add simply leave it out and nothing else moves. */

.addbtn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: calc(36px * var(--ui-scale));
  padding: 0 13px 0 10px;
  border-radius: var(--r-md);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  font-size: calc(13px * var(--ui-scale));
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.addbtn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.addbtn:active { transform: scale(0.97); }
.addbtn .ic { flex: none; }

/* ---------- forms ---------- */

.field { margin-top: 12px; }
.field > label {
  display: block;
  font-size: calc(10px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 5px;
}
.field input, .field select, .field textarea {
  width: 100%;
  min-height: calc(42px * var(--ui-scale));
  padding: 10px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: calc(15px * var(--ui-scale)); /* 15px or more, or iOS Safari zooms the page on focus */
}
/* An explicit height, not just a minimum. A native select on iOS keeps its own
   intrinsic box height and ignores min-height, so UNIT rendered a few pixels
   shorter than the EVERY input beside it and the pair sat unaligned. Fixing the
   height makes both controls in a .two pair exactly the same box. The native
   dropdown arrow is untouched. */
.field input, .field select {
  height: calc(42px * var(--ui-scale));
  line-height: normal;
}
.field textarea {
  height: auto;
  min-height: calc(76px * var(--ui-scale));
  resize: vertical;
}

/* A field has to be allowed to be narrower than its content, or the widest
   control in a pair sets the column width and pushes the other one out of the
   form. iOS is where this bites: it gives a date input an intrinsic width of
   its own and ignores width:100%, so "Oct 9, 2026" rendered wider than its
   box and ran under the field beside it. */
.two > .field { min-width: 0; }
.field input, .field select, .field textarea { min-width: 0; max-width: 100%; }

/* Stripping the native appearance is what makes a date input take the width it
   is given rather than the width it wants, and left-aligns it with every other
   field. Tapping it still opens the platform's own picker. */
.field input[type="date"] {
  -webkit-appearance: none;
  appearance: none;
  display: block;
  width: 100%;
  text-align: left;
}
.field input:focus, .field select:focus, .field textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-color: var(--accent);
}
/* Not scoped to .field — a hint is also used on its own under a pair of
   buttons, where it would otherwise fall back to full body size. */
.hint { font-size: calc(11.5px * var(--ui-scale)); color: var(--ink-3); margin-top: 5px; line-height: 1.45; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.two .field { margin-top: 12px; }

/* The parts a routine uses sit under the picker that adds them, so a part
   appears where you are looking after you choose it. Each one is its own card
   rather than a flush table row: in a form full of edge-to-edge inputs, a
   bordered row with air around it reads as a thing you added. */
.partlist { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.partlist:empty { display: none; }
.row.partrow {
  border: 1px solid var(--card-border);
  border-radius: var(--r-md);
  background: var(--surface);
  padding: 9px 10px;
  gap: 10px;
  min-height: calc(54px * var(--ui-scale));
  cursor: default;
}
.row.partrow:hover, .row.partrow:active { background: var(--surface); }
.row.partrow .title { font-size: calc(14px * var(--ui-scale)); }
.row.partrow .qty {
  flex: none;
  width: calc(66px * var(--ui-scale));
  height: calc(36px * var(--ui-scale));
  min-height: 0;
  padding: 6px 8px;
  text-align: center;
}

.iconpick {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(46px, 1fr));
  gap: 7px;
}
.iconpick button {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 1px solid var(--card-border);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
}
.iconpick button[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

/* ---------- detail ---------- */

.kv { display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; padding: 12px; margin: 0; }
.kv dt {
  font-size: calc(10px * var(--ui-scale));
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding-top: 2px;
}
.kv dd { margin: 0; font-size: calc(14px * var(--ui-scale)); overflow-wrap: anywhere; }
.kv dd a { color: var(--accent); text-decoration: none; }
.kv dd a:hover { text-decoration: underline; }
.kv .mono { font-family: var(--mono); font-size: calc(12.5px * var(--ui-scale)); }

.note {
  font-size: calc(13px * var(--ui-scale));
  color: var(--ink-2);
  line-height: 1.55;
  padding: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.panelbody { padding: 4px 12px 14px; }

/* ---------- empty ---------- */

.empty { text-align: center; padding: 46px 20px; color: var(--ink-3); }
.empty .ic { color: var(--line-strong); margin-bottom: 10px; }
.empty h3 { margin: 0 0 6px; font-size: calc(15px * var(--ui-scale)); font-weight: 600; color: var(--ink-2); }
.empty p { margin: 0 auto; font-size: calc(13px * var(--ui-scale)); max-width: 30em; line-height: 1.5; }

/* ---------- sheet ---------- */

.scrim {
  position: absolute;
  inset: 0;
  background: rgba(10, 16, 14, 0.44);
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: fade 0.16s ease;
  /* The dimming covers the whole window, but the sheet is centred on the panel,
     not on the window. Inside Home Assistant the panel starts to the right of
     the sidebar, so a sheet centred on the window sits about half a sidebar
     left of the column you are actually looking at. The panel measures itself
     and sets these; they are 0 when it already fills the width. */
  padding-left: var(--panel-l, 0px);
  padding-right: var(--panel-r, 0px);
}
@keyframes fade { from { opacity: 0 } }
@keyframes rise { from { transform: translateY(14px); opacity: 0 } }

.sheet {
  background: var(--paper);
  border: 2px solid var(--modal-border);
  width: 100%;
  max-width: 560px;
  /* Viewport units for the same reason, and dvh so a phone's collapsing
     address bar does not leave the sheet taller than the visible area. */
  max-height: 92vh;
  max-height: 92dvh;
  border-radius: 18px 18px 0 0;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  animation: rise 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.sheet:focus { outline: none; }
.sheet > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.sheet > header h2 {
  margin: 0;
  font-size: calc(15px * var(--ui-scale));
  font-weight: 650;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet .inner {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 4px 16px 0;
}

/* The actions stay put while the fields scroll under them. Some forms are
   taller than a phone no matter how much of the window the sheet is given, and
   a Save or Delete you have to go looking for reads as missing. Sticky keeps
   the row in flow, so it also sits at the natural end of a short form. */
.sheet .inner > .btnrow:last-child {
  position: sticky;
  bottom: 0;
  margin-top: 16px;
  padding: 10px 0 calc(16px + var(--safe-b));
  background: var(--paper);
  border-top: 1px solid var(--line);
}

/* ---------- toast ---------- */

/* Fixed, not absolute. Absolute made the overlay the size of the panel, and
   the sheet's max-height a percentage of that — which is fine here but short
   inside Home Assistant, where the panel element does not resolve to the full
   window. The sheet then cut its own content off and you had to scroll inside
   it to reach the buttons. Anchoring to the viewport removes the dependency. */
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
.layer > * { pointer-events: auto; }
.layer:empty { display: none; }

.toast {
  position: absolute;
  left: 50%;
  bottom: calc(20px + var(--safe-b));
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 40px);
  padding: 10px 12px 10px 14px;
  border-radius: var(--r-md);
  background: var(--ink);
  color: var(--paper);
  font-size: calc(13px * var(--ui-scale));
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  animation: rise 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  /* Informational: it must never swallow a tap meant for what is underneath. */
  pointer-events: none;
}
.toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* With a sheet open the action row is pinned to the bottom, which is exactly
   where the toast lives — so an error raised while the form is open would sit
   on the button it is telling you to press again. It moves to the top instead,
   for as long as the sheet is there. */
.layer:has(.scrim) .toast { top: calc(20px + var(--safe-b)); bottom: auto; }
.toast button {
  pointer-events: auto;
  border: 0;
  background: none;
  /* The toast inverts its background, so its accent has to invert with it. */
  color: #5fd3b5;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 6px;
  white-space: nowrap;
  flex: none;
}
:host([data-theme="dark"]) .toast button { color: #0b4a3f; }
.toast[data-tone="error"] { background: var(--rust); color: #fff; }
.toast[data-tone="error"] button { color: #fff; text-decoration: underline; }

/* ---------- loading / error ---------- */

.center {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
  text-align: center;
  color: var(--ink-3);
  font-size: calc(14px * var(--ui-scale));
  line-height: 1.6;
}

/* ---------- wider screens ----------
   The chrome does not change. Only the content's measure does, and the tab
   labels get a little more room to breathe. */

/* Below the desktop breakpoint everything comes up a notch. The sizes here
   were judged on a monitor at reading distance, where they are right; at the
   distance a phone is actually held they read small. */
@media (max-width: 759px) {
  :host { --ui-base: 1.09; }

  /* A formatted date needs more room than half a phone's width, and it is the
     one control that cannot be truncated without becoming unreadable. Only the
     pairs containing one are stacked; the rest stay side by side so the form
     does not become a very long column. */
  .two:has(input[type="date"]) { grid-template-columns: 1fr; }
}

/* The reader's own preference, multiplied on top of whatever the width chose. */
:host([data-text="small"]) { --ui-user: 0.92; }
:host([data-text="large"]) { --ui-user: 1.12; }
:host([data-text="larger"]) { --ui-user: 1.26; }

@media (min-width: 760px) {
  :host { --header-h: calc(56px * var(--ui-scale)); }
  /* Taller, not wider: --tab-pad stays put so the alignment holds, and the
     extra room on a desktop goes into height instead. */
  .tab { min-height: calc(48px * var(--ui-scale)); }
  .sheet { border-radius: 18px; max-height: 88vh; max-height: 88dvh; }
  .scrim { align-items: center; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
