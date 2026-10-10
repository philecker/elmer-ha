<img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/readme_logo.png" alt="Elmer" height="48">

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=philecker&repository=elmer-ha&category=integration)

Home maintenance tracking in the Home Assistant sidebar. Filters, flushes,
batteries and services — what was last done, what is due, and what parts you
have on the shelf for it.

It runs entirely inside Home Assistant — no cloud account, no second app, and
nothing to keep in sync. Your data lives in Home Assistant's own storage, so it
is covered by the backups you already take.

<p>
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/routines.png" alt="The Routines screen on a phone" width="250">
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/equipment.png" alt="A piece of equipment and its routines" width="250">
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/parts.png" alt="Parts on hand, with stock levels" width="250">
</p>

---

## What you get

**A panel in the sidebar.** Five screens — Routines, Equipment, Parts, History and
Settings.

The chrome does not move. A header and one tab row, in the same place at every
width and on every screen; everything else is page content that scrolls. The add
button sits at the end of the header and says what it adds — "Add Routine", "Add
Equipment" — so a control whose action changes with the screen still tells you
what it will do before you press it. Screens with nothing to add leave it out,
and because it is last in the row nothing else moves.

The header, the tab row and the list all share one column, so their edges line
up at every width.

Surfaces, text, dividers and card geometry come from Home Assistant's own theme
variables, so Elmer sits inside whatever theme you run rather than painting its
own panel on top of it. Status colours stay Elmer's, because overdue has to mean
the same thing in every theme. A theme can override them:
`--elmer-accent`, `--elmer-overdue-color`, `--elmer-due-color`.

Tap targets clear 44px and safe-area insets are honoured, so it works held in
one hand.

<p>
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/routines-dark.png" alt="The Routines screen on a dark theme" width="250">
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/log-service-dark.png" alt="Logging a service, with the parts it uses" width="250">
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/settings-dark.png" alt="Settings, including backups" width="250">
</p>

On a wider screen the same layout stretches; nothing is rearranged.

<p>
  <img src="https://raw.githubusercontent.com/philecker/elmer-ha/main/images/desktop.png" alt="Elmer on a desktop browser" width="820">
</p>

**Entities, so the rest of Home Assistant can act on it.**

| Entity | What it is |
| --- | --- |
| `sensor.elmer_overdue` | How many routines are past due. Attributes list them. |
| `sensor.elmer_due_soon` | How many fall inside your warning window. |
| `sensor.elmer_parts_to_reorder` | Parts at or below their reorder point. |
| `sensor.elmer_next_due` | Days until the next thing that isn't already overdue. |
| one per routine | Days until due — **negative when overdue**. |

Per-routine sensors are grouped under a device per piece of equipment, so the
furnace's routines sit together. Days-until is the state rather than a date
because it is what a condition wants to compare: `below: 0` is overdue,
`below: 7` is next week, no template needed.

**Services**: `elmer.complete`, `elmer.undo`, `elmer.adjust_stock`,
`elmer.import_json`, `elmer.export_json`.

---

## Installing

> **Before you publish:** `manifest.json` carries
> `documentation`, `issue_tracker` and `codeowners` pointing at
> `github.com/philecker/elmer-ha` — a guess at the account name, not a verified
> one. Change all three to the repository you actually push to. `hassfest`
> checks those URLs are well formed, not that they lead anywhere.

### Through HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=philecker&repository=elmer-ha&category=integration)

That button opens this repository in your own Home Assistant. By hand instead:

1. HACS ▸ ⋮ ▸ **Custom repositories**
2. Add this repository's URL, type **Integration**
3. Find **Elmer** in HACS and install it
4. **Restart Home Assistant** — a new integration's Python is only loaded at
   startup
5. Settings ▸ Devices & services ▸ **Add integration** ▸ Elmer

Elmer appears in the sidebar straight away. There is nothing to configure.

### By hand

Copy `custom_components/elmer` into your `config/custom_components/` folder, so
you end up with `config/custom_components/elmer/manifest.json`. Then restart and
add the integration as above.

### Requirements

Home Assistant **2025.7 or newer**. Earlier versions lack
`async_register_static_paths`, which is how the panel's files are served.

---

## Importing a backup

If you have an `elmer.json` from somewhere else, bring it in from
**Settings ▸ Data export ▸ Import a file** — pick the file, check what Elmer
says is in it, and choose whether to merge or replace.

To do it from a script instead, put the file in your Home Assistant **config**
folder (the one with `configuration.yaml`) and run the action:

```yaml
action: elmer.import_json
data:
  path: elmer.json
  merge: true
```

`merge: true` matches records by id and updates them in place, so importing a
newer export later updates what changed and loses nothing. `merge: false`
replaces everything, history included.

Older files are migrated on the way in: a part number that used to live on a
routine is lifted to its equipment, a single `contact` field is routed to phone
or email by what it looks like, and `links` becomes the replacement-parts list.

The path has to be inside your config folder. That is deliberate — an action can
be triggered from a script, a dashboard button or the voice assistant, so the
path it is handed is not necessarily one you typed.

---

## Where your data lives

In Home Assistant's own storage, at `.storage/elmer`. That means it is included
in your Home Assistant backups and restored with them — you do not need a
separate backup for Elmer.

**Settings ▸ Data export** has both halves:

- **Export a copy** downloads the file through your browser.
- **Import a file** reads a backup you pick, shows you what is in it, and asks
  whether to merge it into what is here or replace everything.

Both work from a phone over Nabu Casa, because the file is read and written in
the browser rather than on the server — there is nothing to copy into the config
folder first.

The same thing is available as the `elmer.export_json` and `elmer.import_json`
actions if you would rather drive it from a script. `elmer.export_json` with a
`path` writes a file into your config folder; with no path it returns the data in
the action response.

Every route produces the same JSON, so a copy taken one way imports the other.

---

## Automations

Because routine sensors are days-until, the conditions read plainly:

```yaml
# Tell me on Saturday morning if anything is overdue.
triggers:
  - trigger: time
    at: "09:00:00"
conditions:
  - condition: time
    weekday: [sat]
  - condition: numeric_state
    entity_id: sensor.elmer_overdue
    above: 0
actions:
  - action: notify.mobile_app_phone
    data:
      title: Overdue maintenance
      message: >-
        {{ state_attr('sensor.elmer_overdue', 'names') | join(', ') }}
```

```yaml
# Order parts before the routine that needs them comes round.
triggers:
  - trigger: numeric_state
    entity_id: sensor.elmer_parts_short
    above: 0
actions:
  - action: notify.mobile_app_phone
    data:
      title: Order parts
      message: >-
        {{ state_attr('sensor.elmer_parts_short', 'names') | join(', ') }}
```

`sensor.elmer_parts_short` answers a different question from
`sensor.elmer_parts_to_reorder`. The reorder sensor watches each part against
its own threshold. This one adds up what every routine due inside the warning
window actually needs — two routines sharing a filter are counted together —
and reports the parts where that total comes to more than is on the shelf. A
part can sit comfortably above its reorder point and still be one short of
what next week needs, and only this sensor sees it. Its `parts` attribute
carries `needed`, `on_hand`, `short` and the routines asking for each one.

```yaml
# Mark the furnace filter done from a dashboard button.
actions:
  - action: elmer.complete
    data:
      routine: "Furnace / Air Conditioner: Replace Furnace Filter"
```

A routine's plain name works too. If two routines share a name, qualify it with
the equipment as above — an ambiguous name fails the call rather than picking
one at random.

---

## Remote access

Nothing to set up. The panel talks over the authenticated websocket Home
Assistant already has open to your browser, so Nabu Casa and a VPN both work
with no extra configuration, and nothing new is exposed to your network.

---

## Working on it

```bash
npm install --no-save playwright@1.49.1 esbuild@0.24.2
npx playwright install chromium

python3 tools/verify-package.py     # repository structure, manifest, brand sizes
python3 tools/verify-schedule.py    # the date maths against its reference
python3 tools/verify-store.py       # imports, stock, undo, ordering
node    tools/verify-panel.mjs      # the panel, in a real browser

pip install --no-deps homeassistant
python3 tools/verify-imports.py     # every Home Assistant API this uses still exists
```

Three build steps produce committed files, so re-run the relevant one after a
change rather than editing its output:

```bash
node tools/build-brand.mjs        # the integration's icon and logo
node tools/build-screenshots.mjs  # the images in this README
node tools/build-preview.mjs      # a standalone preview page, no install needed
```

`verify-schedule.py` runs about 82,000 inputs through both the Python and the
reference implementation in `tools/reference/`, and fails on any divergence —
month-end clamping, leap days, negative intervals and malformed dates included.
Date arithmetic fails quietly, so it is compared rather than trusted.

`verify-panel.mjs` drives the real panel in Chromium: it completes a routine and
checks the stock drew down, undoes it and checks the stock came back exactly,
triple-taps to prove a double tap cannot log twice, types into a form and pushes
an outside change to prove the form is not wiped, feeds markup through every
text field to prove it is escaped, and measures tap targets, alignment and
colour contrast at phone and desktop widths.

`verify-imports.py` reads Home Assistant's source rather than importing it, so
it runs without the full dependency tree. It is the check that catches an API
being renamed or removed under you.

Everything above runs on every push through `.github/workflows/validate.yml`,
alongside Home Assistant's own `hassfest` and the HACS action.

## Known limits

- **One household.** There is no per-user data; everyone who can see the panel
  sees the same house.
- **No notifications of its own.** Home Assistant does that better; the sensors
  are there for it.
- **Admin-only import.** Anyone who can open the panel can tick routines off and
  edit equipment, but replacing the whole data set is held to the same bar as a
  configuration change.
- **The icon needs 2026.3, and HACS cannot show it at all yet.** Elmer ships its
  own brand images in `custom_components/elmer/brand/`, which Home Assistant
  serves from 2026.3 onwards — before that, a custom integration's images had to
  live in `home-assistant/brands`, and that repository now auto-closes pull
  requests for custom integrations. So on 2026.3 or newer the integrations page
  shows the toolbox; on anything older it shows a placeholder and there is no
  way round it. HACS's own panel shows a placeholder either way: it still
  requests the image straight from `brands.home-assistant.io` rather than
  through Home Assistant's authenticated proxy, which is
  [hacs/integration#5223](https://github.com/hacs/integration/issues/5223),
  open at the time of writing.

---

## Contributions

Thanks to [@adamnorth](https://github.com/adamnorth) for the feedback that
made Elmer better.

---

## Support

Elmer is built and maintained by **Phil Ecker**. It is free and open source,
and everything it records stays on your own Home Assistant — no account, no
tracking, nothing sent anywhere.

Bug reports and ideas are welcome, over on
[the issue tracker](https://github.com/philecker/elmer-ha/issues).

If it has saved you a forgotten filter change or two, you are very welcome to
[buy me a coffee](https://buymeacoffee.com/philecker).

---

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=philecker&repository=elmer-ha&category=integration)
