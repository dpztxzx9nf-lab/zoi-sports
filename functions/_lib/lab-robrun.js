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

export function currentRobRunOf(snapshot) {
  if (!snapshot || typeof snapshot.payload !== "string" || !snapshot.payload) return null;
  let parsed = null;
  try { parsed = JSON.parse(snapshot.payload); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed.settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
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
