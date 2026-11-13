// Elmer's icon set, as SVG strings. One geometry and one optical weight across
// the whole panel, so the glyphs read as a family rather than as borrowed pieces
// — and so the brand mark here and the integration's icon stay the same drawing.

const P = {
  // Brand mark: a toolbox. The lid seam breaks around the latch so the latch
  // stays a distinct shape rather than blurring into the line at small sizes.
  mark: '<g stroke-width="1.95"><path d="M9.4 6.4V5.4a1.5 1.5 0 0 1 1.5-1.5h2.2a1.5 1.5 0 0 1 1.5 1.5v1"/><path d="M2.6 12.1h7.6M13.8 12.1h7.6"/><rect x="2.6" y="6.4" width="18.8" height="13.2" rx="2.2"/><rect x="9.8" y="10.2" width="4.4" height="3.8" rx="1.2"/></g>',

  today: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="m9 16 2 2 4-4"/>',
  // The front of a machine with a round door: the thing in the house that
  // needs looking after, whether that is a furnace, a fridge or a softener.
  // It replaced a ruled rectangle that read as a table or a page layout.
  equipment: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M4 7.5h16"/><circle cx="12" cy="14.6" r="4.3"/><path d="M7.4 5h.01M10 5h.01"/>',
  // A carton with its flaps up: stock on the shelf. Clearer at tab size
  // than the stack of layers it replaced, which could have meant anything.
  supplies: '<path d="M3.5 9.5 6 4h12l2.5 5.5"/><rect x="3.5" y="9.5" width="17" height="11" rx="1.5"/><path d="M12 4v5.5M9.5 13.5h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  // Pointing right, not down: these sit at the end of a row that opens a page
  // of its own, and a downward chevron reads as a disclosure that will expand
  // in place.
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  link: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/>',
  // A photo, for an attachment that cannot be shown; and a page with its
  // corner turned, for a PDF.
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 17"/>',
  document: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5z"/><path d="M14 3.5V8h4.5"/><path d="M8.8 12.5h6.4M8.8 15.8h4.4"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V8M7 12l5-5 5 5M4 20h16"/>',
  undo: '<path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 6v6h6"/>',
  // Pausing a routine and starting it again. Drawn as outlines rather than
  // the solid shapes a media player uses, so they sit with the rest of the
  // set rather than reading as a transport control.
  pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/>',
  play: '<path d="M7.5 5.2a1 1 0 0 1 1.5-.86l9.2 5.8a1 1 0 0 1 0 1.72l-9.2 5.8a1 1 0 0 1-1.5-.86z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  // The two ways a list can be drawn, for the toggle beside the search box.
  // Rows carry a bullet so they are not mistaken for the menu above, and the
  // tiles are square so the pair reads as a choice between two shapes.
  viewlist: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.6" cy="6" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="4.6" cy="18" r="1.15" fill="currentColor" stroke="none"/>',
  viewcards: '<rect x="3" y="3" width="7.6" height="7.6" rx="1.7"/><rect x="13.4" y="3" width="7.6" height="7.6" rx="1.7"/><rect x="3" y="13.4" width="7.6" height="7.6" rx="1.7"/><rect x="13.4" y="13.4" width="7.6" height="7.6" rx="1.7"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v3a2 2 0 0 1-2 2A14 14 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',

  // equipment — pickable per item, so a fridge looks like a fridge
  refrigerator: '<rect x="5.5" y="2.5" width="13" height="19" rx="2"/><path d="M5.5 9.5h13M9 5.8v1.8M9 12.2v2.4"/>',
  dishwasher: '<rect x="3.5" y="3" width="17" height="18" rx="2"/><path d="M3.5 7.5h17M6.4 5.3h.6M9 5.3h.6"/><path d="M8 12.8c1.3 1.7 2.7 1.7 4 0s2.7-1.7 4 0"/>',
  washer: '<rect x="3.5" y="2.5" width="17" height="19" rx="2"/><path d="M3.5 7h17M6.4 4.7h.6"/><circle cx="12" cy="14.2" r="4.2"/>',
  dryer: '<rect x="3.5" y="2.5" width="17" height="19" rx="2"/><path d="M3.5 7h17M6.4 4.7h.6"/><circle cx="12" cy="14.2" r="4.2"/><path d="M9.7 14.2a2.3 2.3 0 0 1 4.6 0"/>',
  oven: '<rect x="3.5" y="3" width="17" height="18" rx="2"/><path d="M3.5 9h17"/><circle cx="7" cy="6" r=".9"/><circle cx="10.4" cy="6" r=".9"/><rect x="6.5" y="12" width="11" height="6" rx="1"/>',
  microwave: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M15.5 5v14"/><circle cx="18.5" cy="9" r=".8"/><path d="M17.4 13h2.2"/>',
  furnace: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M4.5 13h15"/><path d="M12 5c1.8 1.8 2.4 3.3.9 5-1.7-1.1-2.9-2.7-.9-5z"/>',
  waterheater: '<rect x="6" y="4" width="12" height="17" rx="4"/><path d="M12 4V2M9 21v1.4M15 21v1.4M8 9.5h8"/>',
  filterfunnel: '<path d="M3.5 4.5h17l-6.6 8.2v7.3l-3.8 1.9v-9.2z"/>',
  // The pit, the pump standing in it, and the discharge running up and out.
  sumppump: '<path d="M3.8 11.2v8.2a2 2 0 0 0 2 2h12.4a2 2 0 0 0 2-2v-8.2"/><path d="M2.6 11.2h18.8"/><rect x="7.6" y="14.6" width="5" height="7" rx="1"/><path d="M10.1 14.6V8a1.8 1.8 0 0 1 1.8-1.8h4.3a1.8 1.8 0 0 1 1.8 1.8v3"/>',
  // A pop-up head on its riser, throwing three ways.
  sprinkler: '<path d="M12 21.6v-7.2M8.8 21.6h6.4"/><rect x="10.2" y="11" width="3.6" height="3.4" rx="1.2"/><path d="M9.5 10.4C8 8.5 5.9 7.5 3.4 7.3M14.5 10.4c1.5-1.9 3.6-2.9 6.1-3.1M12 10.5V4.4"/>',
  alarm: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8"/>',
  garage: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.8V20h14V9.8"/><path d="M8 20v-6.2h8V20M8 16.6h8"/>',
  mower: '<circle cx="6.5" cy="17.4" r="2.6"/><circle cx="17.2" cy="17.9" r="2.1"/><path d="M4 14.8V9.4h7v5.4"/><path d="M11 10.8h5l3-5.2h2"/>',
  generator: '<rect x="3" y="7.5" width="18" height="11" rx="2"/><path d="M7.5 7.5v-2h9v2"/><path d="m12.6 10-2.4 3.4h3.2L11 17"/>',
  pool: '<path d="M2.5 16.6c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0M2.5 20c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0"/><path d="M7 13.4V5.6a2 2 0 0 1 4 0v7.8M13 13.4V5.6a2 2 0 0 1 4 0v7.8M7 9.4h10"/>',
  // The rest of the pool: the pump that moves the water, the cartridge or sand
  // filter it pushes it through, and the spa that often shares both.
  poolpump: '<circle cx="8.6" cy="12.6" r="4.6"/><circle cx="8.6" cy="12.6" r="1.4"/><path d="M8.6 8v-3h3.6"/><path d="M13.2 10h5.2a1.6 1.6 0 0 1 1.6 1.6v2a1.6 1.6 0 0 1-1.6 1.6h-5.2"/><path d="M5 19.6h11.4"/>',
  poolfilter: '<path d="M6.5 7.6h11v10.8a2.6 2.6 0 0 1-2.6 2.6H9.1a2.6 2.6 0 0 1-2.6-2.6z"/><ellipse cx="12" cy="7.6" rx="5.5" ry="2.4"/><path d="M12 3.1v2.1M9.4 12.4h5.2M9.4 15.8h5.2"/>',
  hottub: '<path d="M3.2 11.4h17.6v5.1a3.5 3.5 0 0 1-3.5 3.5H6.7a3.5 3.5 0 0 1-3.5-3.5z"/><path d="M6.4 20v1.4M17.6 20v1.4"/><path d="M8.6 8.4c-1.1-1.2-1.1-2.3 0-3.5s1.1-2.3 0-3.5M15.4 8.4c-1.1-1.2-1.1-2.3 0-3.5s1.1-2.3 0-3.5"/>',

  // categories
  hvac: '<path d="M4 8h11a3 3 0 1 0-3-3"/><path d="M4 16h13a3 3 0 1 1-3 3"/><path d="M4 12h7"/>',
  water: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/>',
  appliance: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M9 6v1M9 14v2"/>',
  safety: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 9v4"/><circle cx="12" cy="16" r=".6" fill="currentColor"/>',
  exterior: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  vehicle: '<path d="M5 16h14M6 16v2M18 16v2"/><path d="M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16z"/><circle cx="7.5" cy="16" r="1.4"/><circle cx="16.5" cy="16" r="1.4"/>',
  // Three road vehicles, told apart by roofline rather than by badge: the car
  // is low and raked, the SUV upright and square, the truck a cab with a bed
  // behind it. The generic vehicle above stays for anything else with wheels.
  car: '<path d="M3 15.5v-2.2l2-.4 2.2-3.1A2 2 0 0 1 8.8 9h6.4a2 2 0 0 1 1.6.8l2.2 3.1 2 .4v2.2"/><path d="M3 15.5h1.6M9.9 15.5h4.2M19.4 15.5H21"/><circle cx="7.2" cy="15.5" r="1.8"/><circle cx="16.8" cy="15.5" r="1.8"/><path d="M5.2 12.9h13.6"/>',
  suv: '<path d="M3.2 15.6v-3.1l1.5-4A2 2 0 0 1 6.6 7.2h10.8a2 2 0 0 1 1.9 1.3l1.5 4v3.1"/><path d="M3.2 15.6h1.8M9.9 15.6h4.2M19 15.6h1.8"/><circle cx="7.4" cy="15.6" r="1.8"/><circle cx="16.6" cy="15.6" r="1.8"/><path d="M4.7 12.5h14.6M12 7.2v5.3"/>',
  truck: '<path d="M2.4 15.2V8.6a1.6 1.6 0 0 1 1.6-1.6h5.2a1.6 1.6 0 0 1 1.6 1.6v2.6h10.8v4"/><path d="M2.4 15.2h1.7M7.9 15.2h8M19.7 15.2h1.9"/><circle cx="6" cy="15.2" r="1.8"/><circle cx="17.8" cy="15.2" r="1.8"/><rect x="4.4" y="9.1" width="4.4" height="2.1" rx=".5"/>',
  other: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',

  // Animals. Drawn on the same grid and weight as the rest, faces and
  // profiles rather than whole bodies, which stop reading at 19px. Species
  // without a drawing of their own use the paw.
  paw: '<path d="M12 12.6c-2.7 0-5.2 2.9-5.2 5.3 0 1.5 1.1 2.4 2.5 2.4 1.1 0 1.7-.6 2.7-.6s1.6.6 2.7.6c1.4 0 2.5-.9 2.5-2.4 0-2.4-2.5-5.3-5.2-5.3z"/><ellipse cx="5.6" cy="10.2" rx="1.7" ry="2.2"/><ellipse cx="9.3" cy="5.9" rx="1.8" ry="2.4"/><ellipse cx="14.7" cy="5.9" rx="1.8" ry="2.4"/><ellipse cx="18.4" cy="10.2" rx="1.7" ry="2.2"/>',
  dog: '<path d="M7.2 5.2C5 5.4 3.2 7.3 3 10.4c-.1 1.6.6 2.6 1.7 2.6.8 0 1.5-.5 1.9-1.3"/><path d="M16.8 5.2c2.2.2 4 2.1 4.2 5.2.1 1.6-.6 2.6-1.7 2.6-.8 0-1.5-.5-1.9-1.3"/><path d="M6.6 9.5c0-3 2.3-5 5.4-5s5.4 2 5.4 5v5.2c0 3.4-2.4 5.8-5.4 5.8s-5.4-2.4-5.4-5.8z"/><path d="M10 11.2v.4M14 11.2v.4"/><path d="M10.6 15.2h2.8L12 16.8z"/>',
  cat: '<path d="M4.2 10.2V3.6l4.6 3.5a8.6 8.6 0 0 1 6.4 0l4.6-3.5v6.6c.5 1 .8 2.2.8 3.4 0 4.2-3.9 7.2-8.6 7.2s-8.6-3-8.6-7.2c0-1.2.3-2.4.8-3.4z"/><path d="M9 12.6v.5M15 12.6v.5"/><path d="M10.9 16h2.2L12 17.2z"/>',
  // Face on, like the cow, goat and dog beside it: pricked ears, a forelock,
  // the long face narrowing to a soft muzzle with its nostrils.
  horse: '<path d="M8.4 6.4 7.2 2.4l3 2.2M15.6 6.4l1.2-4-3 2.2"/><path d="M7.6 8.2c0-2.2 2-3.6 4.4-3.6s4.4 1.4 4.4 3.6c0 2-.6 3.8-1.4 5.4-.3.7-.2 1.4.2 2.1.4.7.6 1.4.6 2.2 0 2-1.7 3.3-3.8 3.3s-3.8-1.3-3.8-3.3c0-.8.2-1.5.6-2.2.4-.7.5-1.4.2-2.1-.8-1.6-1.4-3.4-1.4-5.4z"/><path d="M12 4.6c-.9 1-1.1 2.4-.4 3.6.7-1 .9-2.4.4-3.6z"/><path d="M9.8 10v.4M14.2 10v.4"/><path d="M10.4 18.2c.3.4.3.8 0 1.2M13.6 18.2c-.3.4-.3.8 0 1.2"/>',
  // A pet bird, perched. The hen it used to be is chicken below.
  bird: '<path d="M6.2 9.2c0-2.6 1.6-4.6 3.8-4.6 2.4 0 4 1.8 4.2 4.2 3 .8 5.4 3.2 6.2 6.4l2 1-2.4.4c-1.4 1.4-3.4 2.2-5.6 2.2-4.6 0-8.2-3.2-8.2-7.4z"/><path d="M6.4 7.6 3.8 8.6l2.4.8"/><circle cx="9.4" cy="7.4" r=".75" fill="currentColor" stroke="none"/><path d="M10.6 12.6c1.4 2 3.8 3 6.4 2.6"/><path d="M4 21h12M10.4 18.6V21M13.2 18.6V21"/>',
  chicken: '<path d="M9.4 5.2c-.2-1.1.6-2 1.6-1.8.4-1 1.8-1 2.2 0 .9-.1 1.5.7 1.2 1.6"/><path d="M8.6 10V8.4a3.2 3.2 0 0 1 6.4 0v1.9c3 .4 5.2 2.8 5.2 5.6 0 2.6-2.3 4.6-5.3 4.6h-4.2C7.4 20.5 5 18 5 14.8V13"/><path d="M8.6 8.6 6 9.8l2.6.9"/><circle cx="11.4" cy="8.2" r=".8" fill="currentColor" stroke="none"/><path d="M10.6 20.5V22.5M14.4 20.5V22.5"/><path d="M12 15.2c1.3 1.4 3.4 1.6 5 .6"/>',
  rabbit: '<path d="M9.2 9.6C7.6 7.3 7 4.6 8 3.3c1.1-1.3 3 .3 3.6 3.4M14.8 9.6c1.6-2.3 2.2-5 1.2-6.3-1.1-1.3-3 .3-3.6 3.4"/><path d="M6 15.2c0-3.6 2.7-6.2 6-6.2s6 2.6 6 6.2c0 3.3-2.7 5.8-6 5.8s-6-2.5-6-5.8z"/><path d="M10 14.4v.5M14 14.4v.5"/><path d="M11 17.4h2L12 18.4z"/>',
  cow: '<path d="M7.3 7.6 3.6 6.4c-.6 1.6.2 3.3 2 3.8l1.6.3M16.7 7.6l3.7-1.2c.6 1.6-.2 3.3-2 3.8l-1.6.3"/><path d="M8.2 6.8 7.4 3.6M15.8 6.8l.8-3.2"/><path d="M7 9.2c0-2.2 2.2-3.6 5-3.6s5 1.4 5 3.6v4.3H7z"/><rect x="7" y="13.5" width="10" height="7" rx="3.5"/><path d="M10 16.9v.3M14 16.9v.3"/><path d="M9.8 10.4v.4M14.2 10.4v.4"/>',
  pig: '<path d="M6.8 7.2 5.4 3.8l3.8 1.6M17.2 7.2l1.4-3.4-3.8 1.6"/><circle cx="12" cy="12.6" r="7.6"/><rect x="9" y="13.4" width="6" height="4.4" rx="2.2"/><path d="M11 15.6v.1M13 15.6v.1"/><path d="M9.2 10.6v.4M14.8 10.6v.4"/>',
  turtle: '<path d="M3.5 16a8.5 7.5 0 0 1 17 0z"/><path d="M9.2 9.2 10.6 12h2.8l1.4-2.8M10.6 12 9 16M13.4 12l1.6 4"/><path d="M20.5 16c1.3 0 2-.8 2-1.9 0-1-.7-1.7-1.6-1.7"/><path d="M7 16v2.5M17 16v2.5"/>',
  fish: '<path d="M2.8 12c2.6-3.6 6-5.4 9.4-5.4 2.9 0 5.1 1.5 6.4 3.3L21.4 7v10l-2.8-2.9c-1.3 1.8-3.5 3.3-6.4 3.3-3.4 0-6.8-1.8-9.4-5.4z"/><circle cx="7.4" cy="11.2" r=".7" fill="currentColor" stroke="none"/>',
  goat: '<path d="M8.6 8.6C8.6 7.1 10.1 6 12 6s3.4 1.1 3.4 2.6v6.2c0 1.9-1.5 3.4-3.4 3.4s-3.4-1.5-3.4-3.4z"/><path d="M9.6 6.4C9 4.2 7.2 3 5 3.4M14.4 6.4c.6-2.2 2.4-3.4 4.6-3"/><path d="M8.6 9.2 4.4 10.4c.6 1.3 2.3 1.6 4.2.9M15.4 9.2l4.2 1.2c-.6 1.3-2.3 1.6-4.2.9"/><path d="M10.9 18 12 21.2l1.1-3.2"/><path d="M10.4 10.6v.4M13.6 10.6v.4"/>',
  sheep: '<path d="M6.6 10.8a2.2 2.2 0 0 1-.2-4.2 2.4 2.4 0 0 1 3.4-2.6 2.6 2.6 0 0 1 4.4 0 2.4 2.4 0 0 1 3.4 2.6 2.2 2.2 0 0 1-.2 4.2"/><path d="M6.6 10.8c.8.6 1.6.6 2.4 0 1 .6 2 .6 3 0 1 .6 2 .6 3 0 .8.6 1.6.6 2.4 0"/><path d="M9.2 11.2V15.4c0 2 1.2 3.6 2.8 3.6s2.8-1.6 2.8-3.6v-4.2"/><path d="M6.8 12.2 3.6 12.8c.4 1.1 1.8 1.5 3.4.9M17.2 12.2l3.2.6c-.4 1.1-1.8 1.5-3.4.9"/><path d="M10.8 13.4v.4M13.2 13.4v.4"/><path d="M11.3 16.6h1.4l-.7.8z"/>',
  duck: '<circle cx="8.8" cy="7" r="3.2"/><path d="M5.7 7.8 2.8 8.4c.2.9 1 1.4 2 1.2l1.4-.4"/><path d="M7.4 10C5.2 10.8 3.8 12.4 3.8 14.2c0 2.6 2.6 4.4 6.2 4.4h4.4c3.8 0 6.2-2.4 6.2-6l-.6-3.4c-1 1.2-2.4 2-4.2 2.2-1.6.2-3.2-.2-4.2-1.6"/><path d="M10 14.2c1.6 1.4 4 1.6 5.6.4"/><circle cx="9.6" cy="6.4" r=".7" fill="currentColor" stroke="none"/>',
  // A small pet in profile — hamster, guinea pig, mouse or rat all read as
  // this at 20px, where any one of them drawn exactly would not.
  mouse: '<path d="M3.2 15.4c1.4-4 5-6.6 9.2-6.6 4 0 6.8 2.6 6.8 5.8 0 1.6-1.2 2.6-2.8 2.6H5.2c-1.6 0-2.4-.8-2-1.8z"/><path d="M8.6 9.8a2.5 2.5 0 1 1 4.6-1"/><path d="M19.2 15.8c1.8.2 2.6 1.4 2.2 2.8-.4 1.4-2 2-3.6 1.4"/><circle cx="7.2" cy="12.8" r=".75" fill="currentColor" stroke="none"/><path d="M9 17v1.8M14 17v1.8"/>',
  alpaca: '<path d="M9.6 21v-8c0-.6-.4-1-1-1H6.4C5 12 4 11 4 9.8c0-1.2 1-2 2.2-2.2L8.8 7"/><path d="M8.8 7 8.4 3.2l2 3.2M12.2 6.4l1-3.2.8 3.6"/><path d="M8.8 7c.2-1 1.4-1.6 2.4-1 1-.6 2.4 0 2.6 1"/><path d="M13.8 7c1 .8 1.6 2 1.6 3.4V21"/><circle cx="8.6" cy="9.2" r=".75" fill="currentColor" stroke="none"/><path d="M4.4 10.6h1"/>',
};

/* The picker, grouped the way a house is: indoors, then the mechanicals, then
   the yard, the pool, what is parked outside, and the catch-alls last. */
/* The animal form's picker. Each species has one of these by default; the
   picker is for the animal that is better drawn as something else — a
   rescue of no particular species, or a goat that the paw undersells. */
export const ANIMAL_ICONS = [
  'dog', 'cat', 'rabbit', 'mouse', 'bird', 'fish', 'turtle',
  'horse', 'cow', 'goat', 'sheep', 'pig', 'alpaca', 'chicken', 'duck', 'paw',
];

export const EQUIPMENT_ICONS = [
  'refrigerator', 'dishwasher', 'washer', 'dryer', 'oven', 'microwave',
  'furnace', 'hvac', 'waterheater', 'water', 'filterfunnel', 'sumppump', 'alarm',
  'garage', 'mower', 'generator', 'sprinkler', 'exterior',
  'pool', 'poolpump', 'poolfilter', 'hottub',
  'vehicle', 'car', 'suv', 'truck',
  'appliance', 'other',
];

export function icon(name, size = 20) {
  const body = P[name] || P.other;
  // The brand mark is drawn to a cropped box so the wordmark can sit against
  // the glyph's real edges rather than the padding around them.
  const box = name === 'mark' ? '1.62 2.92 20.73 17.62' : '0 0 24 24';
  // The size travels as --ic rather than as a fixed width, so one rule in the
  // stylesheet can scale every glyph with the text. The attributes stay as a
  // fallback for anything that renders this markup without those styles.
  return `<svg class="ic" style="--ic:${size}px" viewBox="${box}" width="${size}" height="${size}"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(P, name);
}
