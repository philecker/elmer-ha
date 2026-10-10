// Elmer's icon set, as SVG strings. One geometry and one optical weight across
// the whole panel, so the glyphs read as a family rather than as borrowed pieces
// — and so the brand mark here and the integration's icon stay the same drawing.

const P = {
  // Brand mark: a toolbox. The lid seam breaks around the latch so the latch
  // stays a distinct shape rather than blurring into the line at small sizes.
  mark: '<g stroke-width="1.95"><path d="M9.4 6.4V5.4a1.5 1.5 0 0 1 1.5-1.5h2.2a1.5 1.5 0 0 1 1.5 1.5v1"/><path d="M2.6 12.1h7.6M13.8 12.1h7.6"/><rect x="2.6" y="6.4" width="18.8" height="13.2" rx="2.2"/><rect x="9.8" y="10.2" width="4.4" height="3.8" rx="1.2"/></g>',

  today: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="m9 16 2 2 4-4"/>',
  equipment: '<path d="M3 9h18M9 9v12"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
  supplies: '<path d="M12 3 3 7.5 12 12l9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
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
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V8M7 12l5-5 5 5M4 20h16"/>',
  undo: '<path d="M3 12a9 9 0 1 1 3 6.7"/><path d="M3 6v6h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
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
  alarm: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8"/>',
  garage: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.8V20h14V9.8"/><path d="M8 20v-6.2h8V20M8 16.6h8"/>',
  mower: '<circle cx="6.5" cy="17.4" r="2.6"/><circle cx="17.2" cy="17.9" r="2.1"/><path d="M4 14.8V9.4h7v5.4"/><path d="M11 10.8h5l3-5.2h2"/>',
  generator: '<rect x="3" y="7.5" width="18" height="11" rx="2"/><path d="M7.5 7.5v-2h9v2"/><path d="m12.6 10-2.4 3.4h3.2L11 17"/>',
  pool: '<path d="M2.5 16.6c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0M2.5 20c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0"/><path d="M7 13.4V5.6a2 2 0 0 1 4 0v7.8M13 13.4V5.6a2 2 0 0 1 4 0v7.8M7 9.4h10"/>',

  // categories
  hvac: '<path d="M4 8h11a3 3 0 1 0-3-3"/><path d="M4 16h13a3 3 0 1 1-3 3"/><path d="M4 12h7"/>',
  water: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/>',
  appliance: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 10h14M9 6v1M9 14v2"/>',
  safety: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 9v4"/><circle cx="12" cy="16" r=".6" fill="currentColor"/>',
  exterior: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  vehicle: '<path d="M5 16h14M6 16v2M18 16v2"/><path d="M4 16l1.5-5.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 16z"/><circle cx="7.5" cy="16" r="1.4"/><circle cx="16.5" cy="16" r="1.4"/>',
  other: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
};

export const EQUIPMENT_ICONS = [
  'refrigerator', 'dishwasher', 'washer', 'dryer', 'oven', 'microwave',
  'furnace', 'hvac', 'waterheater', 'water', 'filterfunnel', 'alarm',
  'garage', 'mower', 'generator', 'pool', 'exterior', 'vehicle', 'appliance', 'other',
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
