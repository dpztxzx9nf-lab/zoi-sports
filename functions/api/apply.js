const REGIONS = ["NA-East","NA-Central","NA-West","EU","Other"];
const PLATFORMS = ["PC","Console","Mobile"];
const ROLES = ["ZB player","Content creator","Staff"];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max);
const isUrl = (v) => { try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  let d;
  try {
    const ct = request.headers.get("content-type") || "";
    d = ct.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  } catch { return json({ ok: false, error: "Invalid request." }, 400); }

  // Honeypot: bots fill hidden "website" field. Pretend success.
  if (str(d.website, 200)) return json({ ok: true });

  const a = {
    epic_name: str(d.epic_name, 32), discord: str(d.discord, 40), region: str(d.region, 20),
    platform: str(d.platform, 20), age: parseInt(d.age, 10), role: str(d.role, 30),
    results_link: str(d.results_link, 300), clips_link: str(d.clips_link, 300),
    why: str(d.why, 2000), email: str(d.email, 254),
  };
  const errors = [];
  if (a.epic_name.length < 3) errors.push("Epic name is required.");
  if (a.discord.length < 2) errors.push("Discord username is required.");
  if (!REGIONS.includes(a.region)) errors.push("Pick a region.");
  if (!PLATFORMS.includes(a.platform)) errors.push("Pick a platform.");
  if (!Number.isInteger(a.age) || a.age < 13 || a.age > 99) errors.push("You must be 13 or older to apply.");
  if (!ROLES.includes(a.role)) errors.push("Pick a role.");
  if (a.results_link && !isUrl(a.results_link)) errors.push("Results link must be a valid URL.");
  if (a.clips_link && !isUrl(a.clips_link)) errors.push("Tracker/clips link must be a valid URL.");
  if (a.why.length < 10) errors.push("Tell us why ZOI (at least 10 characters).");
  if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) errors.push("Email looks invalid.");
  if (errors.length) return json({ ok: false, errors }, 422);

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ip_hash = await sha256("zoi:" + ip);
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM applications WHERE ip_hash = ? AND created_at > datetime('now','-1 hour')"
  ).bind(ip_hash).first();
  if (recent && recent.n >= 3) return json({ ok: false, error: "Too many applications from this network. Try again in an hour." }, 429);

  await env.DB.prepare(
    `INSERT INTO applications (epic_name,discord,region,platform,age,role,results_link,clips_link,why,email,ip_hash,user_agent)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(a.epic_name, a.discord, a.region, a.platform, a.age, a.role, a.results_link || null, a.clips_link || null,
         a.why, a.email || null, ip_hash, str(request.headers.get("user-agent"), 200)).run();
  return json({ ok: true });
}

export const onRequest = () => json({ ok: false, error: "Method not allowed." }, 405);
