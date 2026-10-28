/* Shared pieces for the private settings lab.
   Files and folders under functions/ whose names start with an underscore are
   not routed, so nothing here is reachable as an endpoint. */

export const STATUSES = ["testing", "kept", "reverted", "inconclusive"];

/* Settings the player can judge by feel, taken from public/settings.html
   (Fortnite Zero Build controller tab, read 28 October 2026).
   value is the current value as shown on that page. step is the size of one
   move for the suggested next value. */
export const CATALOG = [
  {
    id: "look_horizontal_speed", label: "Look Horizontal Speed", value: "42", type: "int", step: 2, min: 1, max: 100,
    watch: "How a turn across your body lands. Overshooting the doorway or the corner you swung for means it's too fast; not being able to cover the angle at all means it's too slow.",
  },
  {
    id: "look_vertical_speed", label: "Look Vertical Speed", value: "42", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can follow someone jumping, gliding or dropping without sliding past them, and whether looking up from a crouch takes more push than you expect.",
  },
  {
    id: "look_boost_speed", label: "Look Boost Speed", value: "0", type: "int", step: 2, min: 0, max: 100,
    watch: "Whether the end of the stick's travel adds speed you didn't ask for. A hard hold turning on someone behind you either stops where you meant it to or runs past them.",
  },
  {
    id: "look_boost_ramp", label: "Look Boost Ramp", value: "0.0", type: "decimal", step: 0.1, min: 0,
    watch: "How long the extra speed takes to arrive. Watch whether a held turn builds smoothly or shows up as a jolt partway through.",
  },
  {
    id: "look_ease_time", label: "Look Ease Time", value: "0.0", type: "decimal", step: 0.05, min: 0,
    watch: "Whether the view arrives with your thumb or trails behind it. Lag shows up as the crosshair still sliding a moment after you stop pushing.",
  },
  {
    id: "ads_look_horizontal_speed", label: "ADS Look Horizontal Speed", value: "12", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can stay on a strafing target at mid range, and whether turning while aimed in a close fight feels sluggish or overshoots.",
  },
  {
    id: "ads_look_vertical_speed", label: "ADS Look Vertical Speed", value: "12", type: "int", step: 2, min: 1, max: 100,
    watch: "Whether you can track someone dropping or strafing up a ramp while aimed, and whether pulling up onto a head takes more stick than it should.",
  },
  {
    id: "ads_boost_speed", label: "ADS Boost Speed", value: "0", type: "int", step: 2, min: 0, max: 100,
    watch: "Whether the far end of the aim stick swings too far in a close fight. Watch a quick correction past the target and whether it comes back cleanly or bounces.",
  },
  {
    id: "ads_boost_ramp", label: "ADS Boost Ramp", value: "0.0", type: "decimal", step: 0.1, min: 0,
    watch: "How fast the extra aim speed kicks in during a hold. Watch for a turn that starts steady and then surges past the target.",
  },
  {
    id: "ads_look_ease_time", label: "ADS Look Ease Time", value: "0.0", type: "decimal", step: 0.05, min: 0,
    watch: "Whether the aim point follows your thumb directly while aimed. Any smoothing shows up as the scope drifting on after you stop moving the stick.",
  },
  {
    id: "scoped_multiplier", label: "Scope Multiplier", value: "0.95", type: "decimal", step: 0.05, min: 0,
    watch: "Whether a scoped flick overshoots up close or falls short at distance. Watch the first shot after you scope in: past the head, on it, or behind it.",
  },
  {
    id: "move_stick_deadzone", label: "Move Stick Deadzone", value: "0.06", type: "decimal", step: 0.01, min: 0,
    watch: "Whether your character starts moving the moment you push, or stays put while the stick takes up slack. Pan the camera sideways and watch for a step that arrives late.",
  },
  {
    id: "look_stick_deadzone", label: "Look Stick Deadzone", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether the view drifts with your thumb off the stick, or whether the stick feels dead at the start of travel. Small aim corrections show it first.",
  },
  {
    id: "left_trigger_release", label: "Left Trigger Release", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether letting off aim drops the scope straight away or hangs on for a moment. Watch a quick scope in and out on a moving target.",
  },
  {
    id: "right_trigger_release", label: "Right Trigger Release", value: "0.05", type: "decimal", step: 0.01, min: 0,
    watch: "Whether the gun stops the instant you let off, or keeps the last shot going. Watch a single tap in a fight and see whether a second round goes off.",
  },
];

const encoder = new TextEncoder();
const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  },
});

export const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max);

/* Two values that mean the same thing are not a test. Compare numbers numerically
   ("1.0" against "1.00"), strings as they are ("On" against "Off"). */
export const sameValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

/* Constant-time-ish: both sides are hashed to 32 bytes first, so the compare
   walks the same number of steps and the real lengths are never compared. */
export async function sameKey(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* Returns a Response to send instead of the handler's, or null to continue. */
export async function gate(request, env) {
  const expected = typeof env?.LAB_KEY === "string" ? env.LAB_KEY : "";
  if (!expected) return json({ ok: false, error: "The lab key is not configured." }, 500);
  const given = request.headers.get("x-lab-key") || "";
  if (!given || !(await sameKey(given, expected))) return json({ ok: false, error: "Unauthorized." }, 401);
  return null;
}

export async function readBody(request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    const b = await request.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch { return null; }
}

export const SELECT_TEST = "SELECT id,setting,label,from_value,to_value,watch_for,games_planned,games_played,status,result_note,started_at,decided_at FROM lab_tests";

/* Group rows by setting. Input is expected newest first; the first row seen for a
   setting decides the label, so the most recent label wins. */
export function groupBySetting(tests) {
  const map = new Map();
  for (const t of tests) {
    let g = map.get(t.setting);
    if (!g) {
      g = { setting: t.setting, label: t.label, tests: 0, kept: 0, reverted: 0, lastDecidedAt: null };
      map.set(t.setting, g);
    }
    g.tests += 1;
    if (t.status === "kept") g.kept += 1;
    else if (t.status === "reverted") g.reverted += 1;
    if (t.decided_at && (!g.lastDecidedAt || t.decided_at > g.lastDecidedAt)) g.lastDecidedAt = t.decided_at;
  }
  return [...map.values()];
}
