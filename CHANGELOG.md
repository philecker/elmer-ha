# Changelog

Notable changes, newest first. Versions follow [semantic versioning][semver].

HACS does not read this file — the changelog it shows when an update is
available is the body of the GitHub release. This is here for anyone reading
the repository, and the release bodies are written from it.

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
