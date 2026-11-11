/* Call of Duty (Modern Warfare 4 / cod26) catalog, modes, and helpers.

   Settings are global: one snapshot, one set of open tests, regardless of
   mode. Match outcomes are not. A DMZ extraction and a Team Deathmatch win
   are different games, and they are never averaged together.

   Mode list is the MW4 launch roster (official blog: Campaign, Multiplayer,
   DMZ; Warzone runs alongside in Season 1). Zombies is not in the game, so
   it is not in the picker. Campaign and the Mobility Course are not
   competitive matches this lab can score, so they are left out too.

   Multiplayer playlist names: Beebom's launch list, 7 September 2026, checked
   against the official live-worldwide post (20 MP maps, DMZ in Hajin). */

export const COD_GAME = "cod";
export const FORTNITE_GAME = "fortnite";

export const COD_CATALOG = [
  { id: "fov", label: "FOV" },
  { id: "mouse_sensitivity", label: "Mouse Sensitivity" },
  { id: "ads_sensitivity", label: "ADS Sensitivity" },
  { id: "ads_timing", label: "ADS Timing" },
  { id: "mouse_acceleration", label: "Mouse Acceleration" },
  { id: "max_fps", label: "Max FPS" },
  { id: "vsync", label: "VSync" },
  { id: "nvidia_reflex", label: "NVIDIA Reflex" },
];

export const COD_MIN_TRACKED = 4;

export const COD_MODES = [
  { id: "dmz", label: "DMZ", group: "DMZ", outcome: "extraction" },

  { id: "tdm", label: "Team Deathmatch", group: "Multiplayer", outcome: "win" },
  { id: "domination", label: "Domination", group: "Multiplayer", outcome: "win" },
  { id: "hardpoint", label: "Hardpoint", group: "Multiplayer", outcome: "win" },
  { id: "kill_confirmed", label: "Kill Confirmed", group: "Multiplayer", outcome: "win" },
  { id: "ffa", label: "Free for All", group: "Multiplayer", outcome: "win" },
  { id: "counter_attack", label: "Counter Attack", group: "Multiplayer", outcome: "win" },
  { id: "inflation", label: "Inflation", group: "Multiplayer", outcome: "win" },
  { id: "hijack", label: "Hijack", group: "Multiplayer", outcome: "win" },
  { id: "frontline", label: "Frontline", group: "Multiplayer", outcome: "win" },
  { id: "search_and_destroy", label: "Search and Destroy", group: "Multiplayer", outcome: "win" },
  { id: "gunfight", label: "Gunfight", group: "Multiplayer", outcome: "win" },
  { id: "gunfight_10v10", label: "Gunfight 10v10", group: "Multiplayer", outcome: "win" },
  { id: "arms_deal", label: "Arms Deal", group: "Multiplayer", outcome: "win" },
  { id: "combat_outpost", label: "Combat Outpost", group: "Multiplayer", outcome: "win" },
  { id: "frontal_assault", label: "Frontal Assault", group: "Multiplayer", outcome: "win" },
  { id: "gun_game", label: "Gun Game", group: "Multiplayer", outcome: "win" },
  { id: "drop_zone", label: "Drop Zone", group: "Multiplayer", outcome: "win" },

  { id: "warzone", label: "Warzone", group: "Warzone", outcome: "win" },
  { id: "resurgence", label: "Resurgence", group: "Warzone", outcome: "win" },
];

export const COD_MODE_IDS = new Set(COD_MODES.map((m) => m.id));
export const COD_MODE_BY_ID = new Map(COD_MODES.map((m) => [m.id, m]));

export const isCodMode = (id) => COD_MODE_IDS.has(id);
export const modeOf = (id) => COD_MODE_BY_ID.get(id) || null;
export const modeOutcome = (id) => (modeOf(id) && modeOf(id).outcome) || "win";

export const fortniteGameSql = "(game IS NULL OR game = 'fortnite')";

export async function hasColumn(env, table, column) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?")
      .bind(table, column).first();
    return Boolean(row && Number(row.n) > 0);
  } catch {
    return false;
  }
}

export async function gamesPresent(env, owner) {
  const out = { fortnite: false, cod: false, robrun: false };
  try {
    if (await hasColumn(env, "lab_snapshots", "game")) {
      const rows = await env.DB.prepare(
        "SELECT DISTINCT game FROM lab_snapshots WHERE owner = ?"
      ).bind(owner).all();
      for (const r of rows.results || []) {
        if (r.game === "cod") out.cod = true;
        else if (r.game === "robrun") out.robrun = true;
        else if (!r.game || r.game === "fortnite") out.fortnite = true;
      }
    } else {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM lab_snapshots WHERE owner = ?"
      ).bind(owner).first();
      out.fortnite = Boolean(row && Number(row.n) > 0);
    }
  } catch {
    /* an empty or pre-migration lab just has no flags */
  }
  return out;
}

export function currentCodOf(snapshot) {
  if (!snapshot || typeof snapshot.payload !== "string" || !snapshot.payload) return null;
  let parsed = null;
  try { parsed = JSON.parse(snapshot.payload); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed.settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const settings = [];
  for (const entry of COD_CATALOG) {
    const value = Object.prototype.hasOwnProperty.call(raw, entry.id) && raw[entry.id] != null
      ? String(raw[entry.id]).trim() || null
      : null;
    settings.push({ id: entry.id, label: entry.label, value });
  }
  const source = typeof parsed.source === "string" && parsed.source.trim() ? parsed.source.trim() : null;
  return { taken_at: snapshot.taken_at || null, source, settings };
}
