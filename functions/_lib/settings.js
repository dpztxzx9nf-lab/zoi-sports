/* A player's in-game Fortnite settings: the values the public /settings page
   shows, and the ones its owner edits from their own account menu.
   ---------------------------------------------------------------------------
   This file is the one list. The page's rows, the editor's fields, the defaults
   baked into both, and the validation on the way in all come from SETTINGS, so a
   row cannot exist on the page that the editor does not offer, and the editor
   cannot offer a field the page has nowhere to put. The page carries a data-key
   on every row for the same reason: a page test asserts the two lists agree in
   both directions, which is what stops a rename on one side drifting silently
   away from the other.

   What is stored is a flat object of key -> value, in the same units the page
   prints: 42 for a look speed, 0.06 for a deadzone, "Off" for a boolean, "A" for
   a bind. The public read merges the stored values over DEFAULTS, so a field
   added here later shows its default on an older row instead of going blank.

   Three rules, and every one of them is about not printing a lie:

   1. DEFAULTS are the values the page was hand-written with. They are what a
      player who has saved nothing yet sees, and they are what the page still
      falls back to if the read fails.
   2. A value is valid only if it is one of the enum's own values, a boolean, a
      number inside the field's range, or a short string for a bind. Anything
      else is refused by name rather than quietly replaced, because a save that
      silently keeps the old number is worse than one that says no.
   3. Nothing here takes an owner. The handler keys the row off the Access
      identity, the same way every other lab table does. */

/* The groups in page order. The public page draws its <h2>s in this order and
   the editor draws its <fieldset>s from the same list, so the two read alike. */
export const GROUPS = [
  "Display",
  "Graphics Quality",
  "Advanced Graphics",
  "Sound",
  "Look Sensitivity",
  "ADS Look Sensitivity",
  "Stick Deadzones",
  "Controller Binds",
  "Wolverine Extra Buttons",
];

/* scale: the number a slider's filled track is drawn from, as a fraction of it.
   100 for a 0-100 scale, 4 for a 0-4 one, 1 for the 0-1 decimals. It is on the
   field rather than worked out from max because the centred Scope Multiplier
   runs 0.5-2 but fills from 0-2, so max is not the denominator. */
const slider = (key, label, group, min, max, step, scale, value, extra) =>
  ({ key, label, group, type: "slider", min, max, step, scale, value, ...(extra || {}) });

const flag = (key, label, group, value) => ({ key, label, group, type: "bool", value });

const pick = (key, label, group, values, value) => ({ key, label, group, type: "enum", values, value });

const bind = (key, label, group, value) => ({ key, label, group, type: "bind", value, max: 24 });

export const SETTINGS = [
  /* ---- Display ---- */
  pick("window-mode", "Window Mode", "Display", ["Fullscreen", "Borderless", "Windowed"], "Fullscreen"),
  pick("resolution", "Resolution", "Display",
    ["1280 × 720", "1920 × 1080", "2560 × 1440", "3840 × 2160"], "2560 × 1440"),
  /* Frame rate limit is the one number the page prints as plain text rather than
     as a slider, so it keeps that shape here: a number in a plain field. */
  { key: "frame-rate-limit", label: "Frame Rate Limit", group: "Display", type: "plain", min: 30, max: 480, step: 1, value: 240 },
  flag("vsync", "VSync", "Display", false),
  flag("hdr", "HDR", "Display", false),

  /* ---- Graphics Quality ---- */
  pick("anti-aliasing-super-resolution", "Anti-Aliasing & Super Resolution", "Graphics Quality",
    ["Off", "FXAA", "TAA", "TSR", "DLSS"], "DLSS"),
  pick("dlss-quality", "DLSS Quality", "Graphics Quality",
    ["Performance", "Balanced", "Quality", "Quality 2"], "Quality 2"),
  flag("dlss-frame-generation", "DLSS Frame Generation", "Graphics Quality", false),
  slider("3d-resolution", "3D Resolution", "Graphics Quality", 0, 100, 1, 100, 100),
  slider("upscaling-quality", "Upscaling Quality", "Graphics Quality", 0, 100, 1, 100, 85),
  slider("view-distance", "View Distance", "Graphics Quality", 0, 4, 1, 4, 1),
  slider("anti-aliasing", "Anti-Aliasing", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("shadows", "Shadows", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("global-illumination", "Global Illumination", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("reflections", "Reflections", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("post-processing", "Post Processing", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("textures", "Textures", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("effects", "Effects", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("foliage", "Foliage", "Graphics Quality", 0, 4, 1, 4, 0),
  slider("shading", "Shading", "Graphics Quality", 0, 4, 1, 4, 1),
  slider("landscape", "Landscape", "Graphics Quality", 0, 4, 1, 4, 2),

  /* ---- Advanced Graphics ---- */
  flag("motion-blur", "Motion Blur", "Advanced Graphics", false),
  flag("show-grass", "Show Grass", "Advanced Graphics", false),
  flag("nanite", "Nanite", "Advanced Graphics", false),
  flag("ray-tracing", "Ray Tracing", "Advanced Graphics", false),
  flag("dynamic-resolution", "Dynamic Resolution", "Advanced Graphics", false),

  /* ---- Sound ---- */
  pick("sound-quality", "Sound Quality", "Sound", ["Low", "High"], "Low"),
  flag("3d-headphones", "3D Headphones", "Sound", true),

  /* ---- Look Sensitivity ---- */
  slider("look-horizontal-speed", "Look Horizontal Speed", "Look Sensitivity", 1, 100, 1, 100, 42),
  slider("look-vertical-speed", "Look Vertical Speed", "Look Sensitivity", 1, 100, 1, 100, 42),
  slider("look-boost-speed", "Look Boost Speed", "Look Sensitivity", 0, 100, 1, 100, 0),
  slider("look-boost-ramp", "Look Boost Ramp", "Look Sensitivity", 0, 1, 0.01, 1, 0, { dp: 1 }),
  slider("look-ease-time", "Look Ease Time", "Look Sensitivity", 0, 1, 0.01, 1, 0, { dp: 1 }),

  /* ---- ADS Look Sensitivity ---- */
  slider("ads-look-horizontal-speed", "ADS Look Horizontal Speed", "ADS Look Sensitivity", 1, 100, 1, 100, 12),
  slider("ads-look-vertical-speed", "ADS Look Vertical Speed", "ADS Look Sensitivity", 1, 100, 1, 100, 12),
  slider("ads-boost-speed", "ADS Boost Speed", "ADS Look Sensitivity", 0, 100, 1, 100, 0),
  slider("ads-boost-ramp", "ADS Boost Ramp", "ADS Look Sensitivity", 0, 1, 0.01, 1, 0, { dp: 1 }),
  slider("ads-look-ease-time", "ADS Look Ease Time", "ADS Look Sensitivity", 0, 1, 0.01, 1, 0, { dp: 1 }),
  /* Drawn centred: the filled track grows out from the middle because 1.00 is
     the neutral point, not the low end. */
  slider("scope-multiplier", "Scope Multiplier", "ADS Look Sensitivity", 0.5, 2, 0.01, 2, 0.95, { dp: 2, centre: true }),

  /* ---- Stick Deadzones ---- */
  slider("move-stick-deadzone", "Move Stick Deadzone", "Stick Deadzones", 0, 1, 0.01, 1, 0.06, { dp: 2 }),
  slider("look-stick-deadzone", "Look Stick Deadzone", "Stick Deadzones", 0, 1, 0.01, 1, 0.05, { dp: 2 }),
  slider("left-trigger-release", "Left Trigger Release", "Stick Deadzones", 0, 1, 0.01, 1, 0.05, { dp: 2 }),
  slider("right-trigger-release", "Right Trigger Release", "Stick Deadzones", 0, 1, 0.01, 1, 0.05, { dp: 2 }),

  /* ---- Controller Binds ---- */
  bind("bind-jump", "Jump", "Controller Binds", "A"),
  bind("bind-crouch", "Crouch", "Controller Binds", "Right Stick"),
  bind("bind-sprint", "Sprint", "Controller Binds", "Left Stick"),
  bind("bind-fire", "Fire", "Controller Binds", "Right Trigger"),
  bind("bind-aim", "Aim", "Controller Binds", "Left Trigger"),
  bind("bind-use-reload", "Use / Reload", "Controller Binds", "X"),
  bind("bind-next-weapon", "Next Weapon", "Controller Binds", "RB"),
  bind("bind-previous-weapon", "Previous Weapon", "Controller Binds", "LB"),
  bind("bind-pickaxe-harvest", "Pickaxe / Harvest", "Controller Binds", "Y"),
  bind("bind-place-marker", "Place Marker", "Controller Binds", "D-pad Left"),
  bind("bind-edit-switch-mode", "Edit / Switch Mode", "Controller Binds", "B"),
  bind("bind-crouch-repair", "Crouch / Repair", "Controller Binds", "Right Stick"),
  bind("bind-emote-replay", "Emote / Replay", "Controller Binds", "D-pad Down"),
  bind("bind-inventory", "Inventory", "Controller Binds", "D-pad Up"),
  bind("bind-full-screen-map", "Full Screen Map", "Controller Binds", "View"),
  bind("bind-repair-rotate", "Repair / Rotate (build)", "Controller Binds", "Right Stick"),
  bind("bind-material-change", "Material Change", "Controller Binds", "D-pad Left"),
  bind("bind-build-slot-1", "Build Slot 1", "Controller Binds", "Right Trigger"),
  bind("bind-build-slot-2", "Build Slot 2", "Controller Binds", "RB"),
  bind("bind-build-slot-3", "Build Slot 3", "Controller Binds", "Left Trigger"),
  bind("bind-build-slot-4", "Build Slot 4", "Controller Binds", "LB"),
  bind("bind-edit-select", "Edit Select", "Controller Binds", "Right Trigger"),
  bind("bind-complete-edit", "Complete Edit", "Controller Binds", "B"),
  bind("bind-edit-reset", "Edit Reset", "Controller Binds", "Right Stick"),
  bind("bind-simple-build-slot-1", "Simple Build Slot 1", "Controller Binds", "Left Trigger"),
  bind("bind-simple-build-slot-2", "Simple Build Slot 2", "Controller Binds", "Right Trigger"),
  bind("bind-map-zoom-in", "Map Zoom In", "Controller Binds", "Right Trigger"),
  bind("bind-map-zoom-out", "Map Zoom Out", "Controller Binds", "Left Trigger"),
  bind("bind-map-cursor-toggle", "Map Cursor Toggle", "Controller Binds", "A"),
  bind("bind-trait-secondary", "Trait Secondary", "Controller Binds", "RB"),
  bind("bind-trait-utility", "Trait Utility", "Controller Binds", "LB"),
  bind("bind-emote-picker", "Emote Picker", "Controller Binds", "D-pad Down"),
  bind("bind-harvest-tool-alt-interact", "Harvest Tool / Alt Interact", "Controller Binds", "Y"),
  bind("bind-trap-picker-place", "Trap Picker / Place", "Controller Binds", "X"),

  /* ---- Wolverine Extra Buttons ----
     These are the controller's own hardware remaps, not Fortnite's config, which
     is why they read as key names and not as game actions. */
  bind("extra-m1", "M1", "Wolverine Extra Buttons", "B"),
  bind("extra-m2", "M2", "Wolverine Extra Buttons", "X"),
  bind("extra-m3", "M3", "Wolverine Extra Buttons", "A"),
  bind("extra-m4", "M4", "Wolverine Extra Buttons", "Right stick click"),
  bind("extra-m5", "M5", "Wolverine Extra Buttons", "Left stick click"),
  bind("extra-m6", "M6", "Wolverine Extra Buttons", "Y"),
  bind("extra-share", "Share", "Wolverine Extra Buttons", "Print Screen + Alt + Win"),
];

/* The same list as a lookup, built once. Key order is the declaration order
   above, which is what groups() walks. */
export const BY_KEY = new Map(SETTINGS.map((f) => [f.key, f]));

/* Every key, in page order. The page test uses this to check the markup. */
export const KEYS = SETTINGS.map((f) => f.key);

/* The values the page was written with, so a player who has saved nothing and a
   read that failed both show the same thing. */
export const DEFAULTS = Object.fromEntries(SETTINGS.map((f) => [f.key, f.value]));

/* The groups with their fields, for the editor to draw. A copy, so a handler
   that reorders its own answer cannot reorder this one. */
export function groups() {
  return GROUPS.map((name) => ({
    name,
    fields: SETTINGS.filter((f) => f.group === name),
  })).filter((g) => g.fields.length);
}

/* What the editor needs to render one field, without the internal scale rule.
   Sent as `fields` on the editor's GET so the browser never carries a second
   copy of the labels or the ranges. */
export function editorShape() {
  return groups().map((g) => ({
    group: g.name,
    fields: g.fields.map((f) => {
      const out = { key: f.key, label: f.label, type: f.type };
      if (f.type === "enum") out.values = f.values.slice();
      if (f.type === "slider" || f.type === "plain") {
        out.min = f.min; out.max = f.max; out.step = f.step;
        if (f.dp) out.dp = f.dp;
      }
      if (f.type === "bind") out.max = f.max;
      return out;
    }),
  }));
}

/* How a number is printed on the page: whole numbers stay whole, the 0-1 floats
   keep the decimals they are stored with, so 0.06 does not print as 0.1. */
export function formatValue(field, value) {
  if (!field) return String(value);
  if (field.type === "bool") return value === true ? "On" : "Off";
  if (field.type === "enum" || field.type === "bind") return String(value);
  if (field.type === "plain") return String(value);
  if (field.dp) return Number(value).toFixed(field.dp);
  return String(Math.round(Number(value)));
}

/* The fill class the slider draws from: a percentage of the track. It is worked
   out here and not on the page, because the page's baked classes and the ones a
   save produces have to agree exactly - a f47 where the markup says f48 is a
   thumb a pixel off that nobody notices, which is the kind of drift this is for. */
export function fillClass(field, value) {
  const span = Number(field && field.scale ? field.scale : 100);
  const pct = span > 0 ? Math.round((Number(value) / span) * 100) : 0;
  return "f" + Math.max(0, Math.min(100, pct));
}

/* One incoming value, checked against its field. Returns {ok, value} or
   {ok:false, error} - the error names the field, because "invalid settings" tells
   the person at the form nothing about which box to fix. */
export function readField(field, raw) {
  const bad = (why) => ({ ok: false, error: field.label + ": " + why });

  if (field.type === "bool") {
    if (raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "On") return { ok: true, value: true };
    if (raw === false || raw === "false" || raw === 0 || raw === "0" || raw === "Off") return { ok: true, value: false };
    return bad("should be on or off.");
  }

  if (field.type === "enum") {
    const s = typeof raw === "string" ? raw : "";
    if (field.values.includes(s)) return { ok: true, value: s };
    return bad("pick one of " + field.values.join(", ") + ".");
  }

  if (field.type === "bind") {
    if (typeof raw !== "string") return bad("should be a key or button name.");
    const s = raw.replace(/\s+/g, " ").trim();
    if (!s) return bad("cannot be empty.");
    if (s.length > field.max) return bad("is longer than " + field.max + " characters.");
    /* A bind is printed as text and never as markup, but control characters have
       no business in a button name and could break a copy-paste of the page. */
    if (/[\u0000-\u001f\u007f]/.test(s)) return bad("has a control character in it.");
    return { ok: true, value: s };
  }

  /* Everything left is a number. A blank box is refused rather than read as 0:
     an empty look speed is a value nobody typed, not a deliberate zero. */
  const n = typeof raw === "number" ? raw : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN);
  if (!Number.isFinite(n)) return bad("should be a number.");
  if (n < field.min || n > field.max) return bad("should be between " + field.min + " and " + field.max + ".");
  if (field.type === "plain") {
    if (!Number.isInteger(n)) return bad("should be a whole number.");
    return { ok: true, value: n };
  }
  const dp = field.dp || 0;
  const step = Number(field.step) || 1;
  /* Snapped to the field's own step, so 0.055 becomes 0.06 instead of a value
     the slider cannot draw: the page shows what the track can actually sit at. */
  const snapped = Math.round(n / step) * step;
  const clean = Number(snapped.toFixed(Math.max(dp, 2)));
  if (clean < field.min || clean > field.max) return bad("should be between " + field.min + " and " + field.max + ".");
  return { ok: true, value: clean };
}

/* A whole settings object from whatever the request carried. Unknown keys are
   dropped - they are not a way to smuggle a column in, and a browser that sends
   one is out of date rather than wrong. Every known key is required: the editor
   draws all of them, so a missing one means a half-sent form, and writing the
   default over a saved number would be a silent loss. */
export function cleanSettings(input) {
  const values = {};
  const errors = [];
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  for (const field of SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(body, field.key)) {
      errors.push(field.label + ": is missing from the save.");
      continue;
    }
    const r = readField(field, body[field.key]);
    if (r.ok) values[field.key] = r.value;
    else errors.push(r.error);
  }

  return { values, errors };
}

/* A stored row's JSON, read back into a full settings object. A row saved before
   a field existed, or one hand-edited in the database, still answers with every
   key: anything missing or unusable falls back to the default. Reading is the
   wrong place to refuse - a public page with one odd row should still draw. */
export function settingsOf(text) {
  let stored = null;
  try { stored = typeof text === "string" ? JSON.parse(text) : text; } catch { stored = null; }
  const out = { ...DEFAULTS };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const field of SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(stored, field.key)) continue;
    const r = readField(field, stored[field.key]);
    if (r.ok) out[field.key] = r.value;
  }
  return out;
}

/* Every key's printed form, worked out once here so the public page and the
   editor's confirmation cannot print the same number two ways. `text` is what the
   page puts in the row; `fill` is the slider's f-class, and null for every field
   that is not a slider. The page is a printer of this, not a calculator of it:
   the fill rule is a page decision, and a second copy of it in the browser is
   exactly how a thumb ends up a pixel off from the number beside it. */
export function displayOf(values) {
  const out = {};
  for (const field of SETTINGS) {
    const value = Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : field.value;
    out[field.key] = {
      text: formatValue(field, value),
      fill: field.type === "slider" ? fillClass(field, value) : null,
    };
  }
  return out;
}

/* One row as the public page sees it. `owner` is never included: the page has no
   business knowing an email, and the slug is the only name it needs. */
export function publicSettings(row, fallbackGamertag) {
  const values = settingsOf(row ? row.settings : null);
  return {
    gamertag: (row && row.gamertag) || fallbackGamertag || null,
    slug: row ? row.slug || null : null,
    updated_at: row ? row.updated_at || null : null,
    values,
  };
}
