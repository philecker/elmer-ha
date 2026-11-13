# Changelog

Notable changes, newest first. Versions follow [semantic versioning][semver].

The store does not read this file — the changelog shown when an update is
available is the body of the GitHub release, in the Marketplace as it was in
HACS. This is here for anyone reading the repository, and the release bodies
are written from it.

## 1.12.0

### Added

- **Attachments on equipment and animals.** Photos (JPEG, PNG, WebP, HEIC)
  and PDFs, up to 20 MB each and 50 per record, from an Attachments section at
  the bottom of each page. Each shows as a small icon tile for its type; tap
  one to see the photo, rename it, open it full size or delete it. PDFs
  download.
- The files are kept in `elmer/attachments` in your config folder, so Home
  Assistant backups include them, and are served only to signed-in users
  through links Home Assistant signs for an hour. Files nothing refers to any
  more are cleared away on their own. The JSON export lists attachments but
  does not include the files.

## 1.11.0

### Added

- **Add a new supply while making a routine.** The routine form's supplies
  menu ends with New supply…, which opens a small card for its name, how many
  are on hand (0 if you leave it), when to reorder and how many the routine
  uses. It is created with the routine when you save — cancel and nothing is
  made — in the same location as the equipment or animal the routine is for;
  the part number and where to buy it can wait for the Supplies tab. A name
  already on the shelf uses that supply rather than making a second one.
  Editing a routine works the same way, and with no supplies at all the
  section now shows anyway, so a routine can start the list.

### Security

These need a signed-in Home Assistant account to exploit, and matter most in a
house where some accounts are not admins. Please update.

- A record saved by one account can no longer run as script in someone else's
  panel. All text is stored and shown as plain text.
- The import and export actions are admin-only, and an export must be a
  `.json` file outside `www`, `.storage` and `custom_components`. If you ever
  exported a backup into `www`, delete it — anyone could download it.
- Names in the overdue notification are plain text, so a routine can no longer
  put a link in everyone's notifications.

## 1.10.0

### Added

- **Animals.** A new tab for pets and livestock, off by default — Settings ▸
  Animals turns it on, between Equipment and Supplies. Each animal has its own
  page: species and breed, sex, birthdate (exact, or only the year for a
  rescue), color, weight, height, microchip, license, where it came from, its vet's
  number and email, insurance, diet and notes. Medications and vaccinations
  are lists: Add medication gives a row for the medication and its dosage,
  Add vaccination one for the vaccine and the date it was given, and the
  animal's page lists them, its latest vaccination first. Its age is worked
  out for you, and its next birthday is on its page; in the month before, the
  list says so — "Dog · Turns 5 in 4 days".

  Horses and farm animals get How many, for a flock kept as one record. Sex
  uses each animal's own words — mare, stallion and gelding; cow, heifer, bull
  and steer; and so on.

  Their routines are ordinary routines — heartworm every month, the farrier
  every seven weeks — with the same overdue badge, sensors, history and supplies
  as everything else, and a device per animal in Home Assistant. A routine's
  form says "For" while there are animals, with Equipment and Animals grouped.

  Species is a list you build, the way Categories is: the menu offers the
  species your animals use — the same list as Settings ▸ Species, where you
  rename or remove them — and New Species… for another. Type one of Elmer's
  own, "horse" or "Dog", and you get the built-in, with its icon, its words
  for sex and, for farm animals, How many; the form changes as you type. Each animal has an icon picker as equipment does — dog, cat,
  rabbit, small pet, bird, fish, turtle, horse, cow, goat, sheep, pig, alpaca,
  chicken, duck and the paw — and its species chooses one until you pick
  another.

  Weights are in pounds or kilograms, set in Settings beside Animals; until
  you choose, Elmer follows Home Assistant's unit system. Each weight keeps
  the unit it was typed in, so changing the setting converts every animal —
  a 1,050 lbs horse reads 476 kg — rather than relabeling them, and
  switching back gives exactly what you typed.

  Locations stay one list for everything with a place: equipment, animals,
  and where supplies are kept. The barn holds the tractor, the horse and the
  hay, and renaming it in Settings takes all three with it; each location
  there says what it holds, of every kind.

  Deleting an animal works as deleting equipment does: it goes, with its
  routines, and its history stays. Turning Animals off asks first, naming every
  animal and how many routines go with them, then deletes them, keeping their
  history. Importing a file that has animals in it turns the tab on, and says
  so. Equipment is unchanged throughout: its tab, form and pages are exactly
  as they were.

- **History remembers what it was for.** Each entry now keeps the name of the
  equipment or animal it belonged to, so deleting something no longer leaves a
  history of "Annual Vet Exam" twice with nothing to say whose. Entries
  already in your history are named on the first start, from whatever still
  exists; anything deleted before this version had no name kept, and stays
  without one. While the thing exists its current name is shown, so a rename
  still reads through.

- **The calendar in the Home Assistant app for Mac steps out to months and
  years.** Press the month and year at the top for the twelve months, again
  for a page of years — a birthdate eleven years back is three presses rather
  than a hundred and thirty. It also respects a field's latest date, so a
  birthdate cannot be in the future.

### Changed

- **Parts is now Supplies.** Once animals are in, the shelf holds heartworm
  chews, litter and hay as well as filters — and it already held softener salt
  and batteries, which were never parts. The tab, its button, the routine form
  ("Supplies this uses"), history ("Supplies used") and the counts in Settings
  all say Supplies. Part number keeps its name; a supply can still have one.
  Nothing an automation uses has changed: `sensor.elmer_parts_to_reorder`,
  `sensor.elmer_parts_short` and the `adjust_stock` action's `part` field keep
  their names, and backups were already stored as `supplies`.

- **The Category menu matches Settings.** It offers the categories your
  equipment uses — the list Settings ▸ Categories shows — and New Category…
  for another, instead of every built-in whether used or not. Typing the name
  of one of Elmer's own ("Water", "Heating and Cooling") brings it back with
  its icon and suggestions.

- **Every search box just says Search.** Which list it searches is the tab
  you are on. A screen reader still hears the full "Search routines".

- **A one-time routine leaves the list once it is done.** It used to stay
  under a Finished heading at the bottom of Routines, and on its equipment's
  page, with nothing left to do. Now marking it done moves it to the history
  and nowhere else. It no longer counts toward All, the routine count on its
  equipment, or a supply's "used by". Its history entry has an Edit routine
  button, so you can still change its date or make it yearly after all.
  Saving one in the routine form with a Last done date records it in the
  history on that day, the way ticking it off would, so it never vanishes
  without a trace.

- **A snoozed routine says how long until it is due.** Snoozing now moves
  the due date to the day it wakes — or leaves it, if the real date is later
  still — and the row counts down to it: "in 3 days · Snoozed". When that day
  is inside your warning window the routine is under Due soon, colored and
  counted like everything else there; further off, it is under Snoozed. The
  routine's sheet says when it was really due, and Wake up puts it back on
  that date.

  For automations: a snoozed routine's own sensor now reports the days until
  it wakes instead of `unknown`, and it counts toward `sensor.elmer_due_soon`
  and `sensor.elmer_next_due` while inside the window. It is never negative
  while snoozed, so an automation on an overdue routine still stays quiet
  until the snooze ends.

### Fixed

- **One calendar icon in date fields on Firefox.** Firefox draws its own
  calendar button inside a date field and gives no way to hide it, so Elmer's
  icon appeared beside it and the year was cut off. On Firefox, Elmer's icon
  now stands down and the field keeps its full width; every other browser and
  the Home Assistant apps are unchanged.

- **No more "blocking call" warning at startup.** Elmer read its own version
  by opening its manifest file during setup. That is file access on Home
  Assistant's event loop, which Home Assistant logs as a bug in the
  integration, asking you to report it, every time it starts. The version now
  comes from Home Assistant's own record of the integration.

### Note

- A file exported from 1.10.0 with animals in it, imported into an older
  Elmer, shows the animals on the Equipment tab. Nothing is lost, and
  updating again puts them back on their own.

## 1.9.3

### Fixed

- **The calendar in the Home Assistant app for Mac.** A date field there
  opened the iPad's date picker — a tinted popover with Reset and a check
  mark that looked like nothing else in Elmer and nothing like the calendar
  a browser on the same Mac shows. The Mac app is the iPad app running on
  macOS, so the system draws an iPad control, outside the page where no
  styling can reach it. Elmer now draws its own calendar there instead: the
  month with arrows either side, six weeks so it never changes height, today
  ringed and the chosen day filled in the accent colour, and Today — plus
  Clear on the fields you can leave empty — along the bottom. It follows
  light and dark, works from the keyboard (arrows by day and week, Page
  Up/Down by month, Enter to choose, Escape to close without losing the form
  underneath), and starts the week on the day set in your Home Assistant
  profile.

  Only the Mac app gets it. In a browser and on an iPhone or iPad the
  system's own picker is left as it was: it already looks right there, and on
  a phone it is the better control.

- **The hint under Last done** still said a never-done interval "has nothing
  to count from". Since 1.9.2 it counts from the day the routine was added,
  and the hint now says so.

## 1.9.2

### Fixed

- **A routine nobody had done yet never went overdue.** It would count down
  to its date, show as due, and then the next morning go quietly back to
  fine with another year on the clock. The cause was the anchor: a routine
  with no history was measured from today, and "the next November after
  today" moves forward as today does, so the date it was counting towards
  could never fall behind. Every routine now keeps the day it was added and
  is measured from that, which stays put — so a seasonal job, a clock
  change, a specific date and an interval all age past their date and stay
  overdue until they are done.

  Routines already in the file are stamped with the day you upgrade, since
  the day they were really added was never recorded. They will come due on
  schedule from here and fall behind properly after that. Anything with a
  history is untouched; its last-done date was always the anchor and always
  worked.

  An interval that has never been done is now due the day it arrives and
  overdue the day after, rather than sitting at zero days left for good.

  There is a test on it now that walks the clock across a routine's due
  date and insists the answer goes due, then overdue, and stays there. The
  bug survived because every single day of it looked right on its own; only
  the sequence was wrong.

### Changed

- **Installing is written for the Marketplace**, which replaced HACS in Home
  Assistant 2026.11: Settings ▸ Marketplace ▸ Add from link, and a note that
  it asks to connect a GitHub account the first time, since it reads custom
  repositories straight from GitHub. The HACS instructions are kept below for
  2026.10 and older, with a line saying there is nothing to redo on upgrading
  — HACS hands what it installed over to the Marketplace.

## 1.9.1

No changes. The v1.9.0 tag was cut on the previous commit, so the release of
that name carried 1.8.1's code: HACS reported 1.9.0 because it shows the tag,
while the panel reported 1.8.1 because it reads the manifest that was actually
installed. The tag cannot simply be moved — HACS has 1.9.0 recorded as
installed and will not offer it again — so the same code goes out under a
number nobody has yet.

Everything listed under 1.9.0 below arrives here.

## 1.9.0

### Added

- **The history is divided by month as well as by year.** The year keeps its
  rule across the page and its own tally; each month sits under it with a
  count of its own, at the end of a curve that turns off the heading and
  becomes the rail for that month's entries, closing on the same bend under
  the last of them.

- **What each service cost, in a column of its own**, with a total on any
  month that had more than one priced entry. It used to be a bare number in
  the middle of the context line, where it read as debris rather than as a
  figure. A cost of zero — which is what a warranty job gets typed in as —
  prints nothing, since a zero in a money column reads as an error.

- **A setting to turn those costs off**, under Settings → Appearance. It takes
  the column and the monthly totals together; nothing already typed is lost.

### Changed

- **An entry's context line wraps instead of being cut off.** Equipment, parts
  and whatever was typed in the notes shared one ellipsised line with the
  cost, which put the interesting half of every entry behind a tap.
- Rows carry the day alone rather than the month and the day. The month is the
  heading above them, so printing it on every row said the same thing twelve
  times over.

## 1.8.1

### Changed

- **The ring now shows how near the day is, not how worn the routine is.** It
  used to fill with the proportion of the service interval that had elapsed,
  which is a different quantity wearing the same clothes: fourteen days is a
  bigger slice of a month than of six months, so a six-monthly routine a
  fortnight away drew a fuller ring than a monthly one five days away. The
  ring has a count of days printed in the middle of it and sits in a list
  ordered by those days, so of the two quantities that is the one it has to
  agree with.

  It is now drawn against the warn-ahead window: empty as a routine enters Due
  soon, full on the day, full while overdue. Nothing can be fuller than
  something with fewer days left, whatever the two intervals are.

  One consequence to expect: everything under Up to date now shows an empty
  ring, because none of it is inside the warn-ahead window yet. Widening
  warn-ahead under Settings starts the rings filling earlier.

### Fixed

- **The ring on a routine nobody has done yet** was drawn empty, so a routine
  due tomorrow sat in Due soon next to full rings looking like the least
  urgent thing on the screen. The new ring wants no history, so it reads the
  same whether or not anybody has got to the routine. Introduced in 1.8.0.

- **Tiles with nothing in the equipment field** put their "in 1 day" where
  their neighbours keep the equipment name, a line below everything else on
  the row. The second line is now reserved whether or not there is anything to
  put in it. Also introduced in 1.8.0.

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
