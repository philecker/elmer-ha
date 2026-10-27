# Changelog

Notable changes, newest first. Versions follow [semantic versioning][semver].

HACS does not read this file — the changelog it shows when an update is
available is the body of the GitHub release. This is here for anyone reading
the repository, and the release bodies are written from it.

## 1.8.0

### Changed

- The two buttons under Data export now read **Export Data** and **Import
  Data**, rather than "Export a copy" and "Import a file".

### Added

- **Two more kinds of schedule.** A routine can now be anchored to a **clock
  change** — spring, fall, or both, on the United States dates (forward on the
  second Sunday in March, back on the first Sunday in November) — or to a
  **specific date**, either every year or once only.

  Once only is a job with an end. Mark it done and Elmer stops scheduling it,
  keeps it in the history, and files it under Finished rather than leaving it
  looking overdue forever.

- **A routine you have never done now says when it is due.** It used to read
  "not scheduled", because a date was only ever worked out from the last time
  you did it. Three of the four kinds know their own dates and no longer need
  one: a routine anchored to November is due in November whether or not
  anybody has ever got to it.

  An interval has nothing to count from, so a routine on one that has never
  been done is now treated as due today. That is a change in behaviour, not
  only in wording: these count towards the due tally, can go overdue, reach
  the sidebar badge and the sensors, and their parts show up under what the
  schedule needs.

### Changed

- Which kind of schedule a routine is on is now recorded on the routine rather
  than worked out from what it happens to hold. It used to be inferred —
  months on the record meant seasonal — which cannot survive four kinds, since
  a routine can hold a date and an interval and a set of months at once. One
  consequence worth having: switching between kinds no longer discards the
  settings of the one you switched away from.
- The "Never done" filter is now "No schedule", which is all it can mean now:
  a routine whose schedule has nothing in it to work a date out from.

## 1.7.0

### Added

- **One more card per row at each end**: four across on a desktop, three on a
  phone. The previous ceilings were three and two.

  Four on a desktop was offered once before and taken away, because at the
  820px measure it left about 190px a card. The content width setting added in
  1.6.0 is what brings it back — at Wide a card is about 245px and at Widest
  about 305px.

  Both new counts are the tight end of their range rather than a better
  default, and neither default moves. Three across a phone is about 107px a
  card, which wraps a part name like "Softener Salt (40 lb)" onto three lines.
  It fits more on screen; whether that is worth it is a judgement for whoever
  is looking at the screen.

## 1.6.1

### Fixed

- **The sidebar icon going missing after an update**, coming back on the next
  page load. A side effect of the 1.5.1 fix for the blank panel.

  The icon set is registered by a small script Home Assistant is asked to put
  on every page, and the URL of that script is written into the Home Assistant
  index page server side. That page is served StaleWhileRevalidate by Home
  Assistant's service worker, so the first load after an update gets the
  previous copy of it and refreshes it behind. 1.5.1 moved the version into
  the path the frontend is served from, which meant the stale index asked for
  a directory that is no longer registered: a 404, no icon set, and a blank
  sidebar row for the life of that page.

  The icon script now has a stable URL that every version serves, so a stale
  index names a file that still exists. The panel keeps its versioned path —
  the two fail differently, and a panel module paired across versions is what
  made 1.5.0 blank in the first place.

## 1.6.0

### Added

- **A content width setting**, under Settings → Appearance. Elmer has always
  held its content to 820px; alongside that default there are now Wide
  (1040px) and Widest (1280px).

  It is one setting rather than the desktop/mobile pair that font size and
  cards per row use, because a phone's window is narrower than the narrowest
  of the three — nothing chosen here can bind there. The steps stop at 1280
  rather than offering the full window: a list row read edge to edge on a wide
  monitor is a long way for the eye to travel back to the start of the next
  one.

  The header, the tab strip and the content share one measure, so they keep
  their common left edge at every step.

## 1.5.1

### Fixed

- **A blank panel after updating.** Elmer's sidebar icon appeared and was
  selectable, but the panel beside it came up empty, with nothing in the Home
  Assistant log.

  The panel's entry point carried the version in a query string while the
  modules it imports did not, so Home Assistant's service worker could pair a
  freshly fetched entry point with its cached copy of the previous version's
  modules. A module importing a name its dependency does not export never
  evaluates, so the panel's custom element was never defined. The frontend is
  now served from a path containing the version — `/elmer_frontend/1.5.1/` —
  which versions every import along with it and makes that pairing impossible.

  If the panel is still blank immediately after updating, clear the frontend
  cache once: in a browser, DevTools → Application → Service Workers →
  Unregister, then reload; in the companion app, Settings → Companion app →
  Debugging → Reset frontend cache.

### Documentation

- How to put Elmer's counts on a dashboard, with the YAML for a glance card.
  No custom card and no extra download — the counts are ordinary sensors.
- Screenshots of seasonal schedules, snoozing and the card view.
- `sensor.elmer_parts_short` was missing from the entity table, and a
  per-routine sensor reads `unknown` while its routine is paused or snoozed,
  which was not written down anywhere.

## 1.5.0

### Added

- **Seasonal routines.** A routine can be anchored to one or more months
  instead of an interval, so a job tied to the weather lands in the same month
  every year rather than drifting later each time you get to it late.
- **Snooze.** Put a routine to sleep for 3 days, a week, two weeks or a month.
  It expires on its own, marking the job done ends it early, and it never
  changes the record of when the work was actually last done.
- **`sensor.elmer_on_track`**, the third count a dashboard wants beside
  Overdue and Due soon.

### Changed

- A snoozed routine leaves the overdue group for a **Snoozed** group of its
  own, and still shows that it is overdue underneath — putting something off
  does not hide how long it has been waiting.
- While snoozed or paused, a routine's sensor reads `unknown`, so automations
  stay quiet about something you have set aside.

## 1.4.0

### Added

- **Pause a routine**, indefinitely, for anything you are not tracking at the
  moment.
- **An opt-in overdue notification.** Home Assistant gives a custom panel's
  sidebar row no badge of its own, so this keeps one notification listing what
  is overdue, which badges the Notifications row. Off by default.
- **A card view** beside each search box, on Routines, Equipment and Parts,
  with how many cards go in a row set separately for a desktop and a phone.
- **Sorting** on the equipment and parts lists, alphabetically or by date,
  either way round.

### Fixed

- The sidebar icon no longer vanishes until the page is reloaded.
- The pause note has its padding back, and the buttons above it are sticky
  again on a long form.

[semver]: https://semver.org/
