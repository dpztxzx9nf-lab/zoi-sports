/* ROB RUN (Steam 4262460, Kefir) catalog and helpers.

   Settings live in a local JSON file the helper reads. Match/run history is
   server-side and is not written to disk, so this module does not invent
   run outcomes. */

export const ROBRUN_GAME = "robrun";
export const ROBRUN_CATALOG = [
  { id: "sensinivity_volume", label: "Mouse sensitivity" },
  { id: "sensinivity_volume_aim", label: "Aim sensitivity" },
  { id: "hold_sprint", label: "Hold to sprint" },
  { id: "hold_aim", label: "Hold to aim" },
  { id: "resolution_setting", label: "Resolution" },
  { id: "fullscreen_setting", label: "Fullscreen" },
  { id: "frame_rate_setting", label: "Frame rate" },
  { id: "vsync_setting", label: "VSync" },
  { id: "render_scale_setting", label: "Render scale" },
  { id: "anti_aliasing_mode_id_setting", label: "Anti-aliasing" },
  { id: "setting_quality", label: "Quality" },
  { id: "cast_shadow_setting", label: "Shadows" },
  { id: "motion_blur_setting", label: "Motion blur" },
  { id: "depth_of_field", label: "Depth of field" },
  { id: "hdr_setting", label: "HDR" },
  { id: "hbao_setting", label: "HBAO" },
  { id: "settings_grass", label: "Grass" },
  { id: "settings_water", label: "Water" },
  { id: "post_processing_setting", label: "Post processing" },
  { id: "anisotropic_filtering", label: "Anisotropic filtering" },
];

export const ROBRUN_MIN_TRACKED = 8;

/* ROB RUN leaves a setting out of its settings file when it is at the game's
   default, instead of writing the value. Snapshots 137-144 show it: VSync,
   HBAO, motion blur and depth of field only ever appear as "true", and each one
   drops out of the file when it is switched off (VSync after snapshot 141).
   Frame rate is saved as an index ("2") and drops out at the default, which the
   file never names, so it reads as "Default" rather than a made-up number.
   A full snapshot (enough tracked keys to be the whole file) without one of
   these keys means that default. */
export const ROBRUN_ABSENT_DEFAULTS = {
  vsync_setting: "false",
  hbao_setting: "false",
  motion_blur_setting: "false",
  depth_of_field: "false",
  frame_rate_setting: "Default",
};

export function withRobRunDefaults(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return settings;
  const present = Object.keys(settings).filter((k) => settings[k] != null && String(settings[k]).trim() !== "");
  if (present.length < ROBRUN_MIN_TRACKED) return settings;
  const out = { ...settings };
  for (const [id, value] of Object.entries(ROBRUN_ABSENT_DEFAULTS)) {
    if (out[id] == null || String(out[id]).trim() === "") out[id] = value;
  }
  return out;
}

export function currentRobRunOf(snapshot) {
  if (!snapshot || typeof snapshot.payload !== "string" || !snapshot.payload) return null;
  let parsed = null;
  try { parsed = JSON.parse(snapshot.payload); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) return null;
  const raw = withRobRunDefaults(parsed.settings);
  const settings = [];
  for (const entry of ROBRUN_CATALOG) {
    const value = Object.prototype.hasOwnProperty.call(raw, entry.id) && raw[entry.id] != null
      ? String(raw[entry.id]).trim() || null
      : null;
    settings.push({ id: entry.id, label: entry.label, value });
  }
  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : null;
  return { taken_at: snapshot.taken_at || null, source, settings };
}
