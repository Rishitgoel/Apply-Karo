// Apply karo — icon set.
//
// One 16x16 grid, one stroke weight, one set of joins. Defining them once means
// the popup, the dashboard and the on-page panel cannot drift into three
// slightly different visual languages, which is what a per-page copy-paste of
// Material paths had produced.

const wrap = (body, extra = "") =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

/* The bolt does double duty: it is the wordmark and it is the generic "fast"
   icon. One definition rather than two literals, so a tweak to the shape cannot
   leave the logo and the icon drawing slightly different bolts. */
const BOLT = `<path d="M8.5 1.5 3 9h4l-.5 5.5L13 7H9l-.5-5.5Z"/>`;

export const ICONS = {
  /** The wordmark: a bolt, drawn white on the black tile. */
  brand: wrap(BOLT),

  bolt:      wrap(BOLT),
  steps:     wrap(`<path d="M2 12.5h3v-3h3v-3h3v-3h3"/>`),
  search:    wrap(`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/>`),
  undo:      wrap(`<path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6"/><path d="m5 3.5-2.5 3 2.5 3"/>`),
  user:      wrap(`<circle cx="8" cy="5.3" r="2.6"/><path d="M2.8 13.7a5.2 5.2 0 0 1 10.4 0"/>`),
  cap:       wrap(`<path d="M1.5 5.8 8 2.5l6.5 3.3L8 9.1Z"/><path d="M4 7.4v3.4c0 1 1.8 1.9 4 1.9s4-.9 4-1.9V7.4"/>`),
  briefcase: wrap(`<rect x="1.8" y="4.8" width="12.4" height="8.4" rx="1.3"/>
    <path d="M5.6 4.8V3.6a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.2"/><path d="M1.8 8.4h12.4"/>`),
  link:      wrap(`<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/>
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>`),
  doc:       wrap(`<path d="M9 1.6H4.3a1.3 1.3 0 0 0-1.3 1.3v10.2a1.3 1.3 0 0 0 1.3 1.3h7.4a1.3 1.3 0 0 0 1.3-1.3V5.6Z"/>
    <path d="M9 1.6v4h4"/><path d="M5.8 8.8h4.4M5.8 11.2h2.8"/>`),
  pen:       wrap(`<path d="M11.2 2.3a1.7 1.7 0 0 1 2.5 2.4L5.6 12.8l-3.2.8.8-3.2Z"/><path d="m10.2 3.3 2.5 2.5"/>`),
  list:      wrap(`<path d="M5.6 4h8.4M5.6 8h8.4M5.6 12h8.4"/><path d="M2.4 4h.01M2.4 8h.01M2.4 12h.01"/>`),
  brain:     wrap(`<circle cx="8" cy="8" r="6.2"/><path d="M8 5v3.6M8 11h.01"/>`),
  sliders:   wrap(`<path d="M2.2 4.6h11.6M2.2 11.4h11.6"/><circle cx="6" cy="4.6" r="1.7"/><circle cx="10.4" cy="11.4" r="1.7"/>`),
  chart:     wrap(`<path d="M2.2 13.2h11.6"/><path d="M4.4 13.2V8.4M7.6 13.2V4.6M10.8 13.2v-3"/>`),
  check:     wrap(`<path d="m3 8.4 3.2 3.2L13 4.8"/>`),
  x:         wrap(`<path d="m4.4 4.4 7.2 7.2m0-7.2-7.2 7.2"/>`),
  plus:      wrap(`<path d="M8 3.2v9.6M3.2 8h9.6"/>`),
  trash:     wrap(`<path d="M2.8 4.4h10.4"/><path d="M6.2 4.4V3.2a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2"/>
    <path d="M12 4.4v8.2a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 12.6V4.4"/>`),
  upload:    wrap(`<path d="M8 10.6V2.8"/><path d="m4.8 6 3.2-3.2L11.2 6"/><path d="M2.6 10.4v1.8a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>`),
  download:  wrap(`<path d="M8 2.8v7.8"/><path d="m4.8 7.4 3.2 3.2 3.2-3.2"/><path d="M2.6 10.4v1.8a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>`),
  copy:      wrap(`<rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.3"/><path d="M10.6 5.4V3.7a1.3 1.3 0 0 0-1.3-1.3H3.7a1.3 1.3 0 0 0-1.3 1.3v5.6a1.3 1.3 0 0 0 1.3 1.3h1.7"/>`),
  sun:       wrap(`<circle cx="8" cy="8" r="3"/><path d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M12.7 3.3l-1 1M4.3 11.7l-1 1"/>`),
  moon:      wrap(`<path d="M13.2 9.4A5.6 5.6 0 0 1 6.6 2.8a5.8 5.8 0 1 0 6.6 6.6Z"/>`),
  monitor:   wrap(`<rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.3"/><path d="M5.6 14h4.8M8 11.2V14"/>`),
  shield:    wrap(`<path d="M8 1.8 3 3.8v4.1c0 3 2.1 5.3 5 6.3 2.9-1 5-3.3 5-6.3V3.8Z"/><path d="m6 8 1.5 1.5L10.2 6.6"/>`),
  clock:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.4"/>`),
  globe:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M2.2 8h11.6"/><path d="M8 2a9.5 9.5 0 0 1 0 12 9.5 9.5 0 0 1 0-12Z"/>`),
  alert:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 5v3.4M8 10.8h.01"/>`),
  info:      wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 7.4V11M8 5.2h.01"/>`),
  external:  wrap(`<path d="M9.4 2.6h4v4"/><path d="m13.4 2.6-6 6"/><path d="M11.6 9.2v3.1a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V5.6a1.2 1.2 0 0 1 1.2-1.2h3.1"/>`),
  chevron:   wrap(`<path d="m6 3.6 4.4 4.4L6 12.4"/>`),
  eye:       wrap(`<path d="M1.4 8S3.8 3.6 8 3.6 14.6 8 14.6 8 12.2 12.4 8 12.4 1.4 8 1.4 8Z"/><circle cx="8" cy="8" r="2"/>`),
  eyeOff:    wrap(`<path d="M6.3 3.9A6.3 6.3 0 0 1 8 3.7c4.2 0 6.6 4.3 6.6 4.3a12 12 0 0 1-2.1 2.7"/>
    <path d="M4.2 5.1A12 12 0 0 0 1.4 8s2.4 4.3 6.6 4.3a6.2 6.2 0 0 0 2.4-.5"/><path d="m2.4 2.4 11.2 11.2"/>`),
  power:     wrap(`<path d="M8 2.4v5.2"/><path d="M11.6 4.5a5 5 0 1 1-7.2 0"/>`),
  sparkle:   wrap(`<path d="M8 2.2 9.3 6 13 7.3 9.3 8.6 8 12.4 6.7 8.6 3 7.3 6.7 6Z"/><path d="M12.6 11.2v2.4M11.4 12.4h2.4"/>`),
  target:    wrap(`<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.6"/>`),
  archive:   wrap(`<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3.2 6v6.4a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V6"/><path d="M6.6 9h2.8"/>`),
  mail:      wrap(`<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.4"/><path d="m2.4 4.6 5.6 4 5.6-4"/>`),
  bug:       wrap(`<rect x="5" y="4.8" width="6" height="8" rx="3"/>
    <path d="M6.2 5.2a1.8 1.8 0 0 1 3.6 0"/><path d="M5 7.4H2.6M5 10.6H2.8M11 7.4h2.4M11 10.6h2.2"/>`)
};

/** Convenience for building markup strings. */
export const icon = (name, cls = "") =>
  cls ? ICONS[name].replace("<svg ", `<svg class="${cls}" `) : ICONS[name];
