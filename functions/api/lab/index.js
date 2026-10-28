import { CATALOG, SELECT_TEST, gate, groupBySetting, json, readBody, sameValue, str } from "../../_lib/lab.js";

const SETTING_MAX = 60;
const LABEL_MAX = 80;
const VALUE_MAX = 24;
const WATCH_MAX = 600;

const badGameCount = v => {
  if (v === undefined || v === null || v === "") return false;   // optional
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return !Number.isInteger(n) || n < 1 || n > 50;
};

export async function onRequest({ request, env }) {
  const blocked = await gate(request, env);
  if (blocked) return blocked;

  if (request.method === "GET") {
    try {
      const { results } = await env.DB.prepare(`${SELECT_TEST} ORDER BY started_at DESC, id DESC`).all();
      const tests = results || [];
      return json({ ok: true, tests, settings: groupBySetting(tests), catalog: CATALOG });
    } catch (e) {
      console.error("lab list failed", e);
      return json({ ok: false, error: "Couldn't read the log." }, 500);
    }
  }

  if (request.method === "POST") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, errors: ["Send the test as JSON."] }, 422);

    const setting = str(body.setting, SETTING_MAX);
    const label = str(body.label, LABEL_MAX);
    const from_value = str(body.from_value, VALUE_MAX);
    const to_value = str(body.to_value, VALUE_MAX);
    const watch_for = str(body.watch_for, WATCH_MAX);
    const gamesRaw = body.games_planned;

    const errors = [];
    if (!setting) errors.push("Pick a setting.");
    if (!label) errors.push("The setting needs a label.");
    if (!from_value) errors.push("From value is required.");
    if (!to_value) errors.push("To value is required.");
    if (from_value && to_value && sameValue(from_value, to_value)) errors.push("To value has to differ from the from value.");
    if (badGameCount(gamesRaw)) errors.push("Games planned must be a whole number from 1 to 50.");

    if (errors.length) return json({ ok: false, errors }, 422);

    const games = gamesRaw === undefined || gamesRaw === null || gamesRaw === "" ? null : Number(String(gamesRaw).trim());

    try {
      const row = await env.DB.prepare(
        `INSERT INTO lab_tests (setting,label,from_value,to_value,watch_for,games_planned,status)
         VALUES (?,?,?,?,?,?,'testing')`
      ).bind(setting, label, from_value, to_value, watch_for || null, games).run();
      const id = row?.meta?.last_row_id ?? null;
      return json({ ok: true, id }, 201);
    } catch (e) {
      console.error("lab insert failed", e);
      return json({ ok: false, error: "Couldn't save the test. Has the migration been applied?" }, 500);
    }
  }

  return json({ ok: false, error: "Method not allowed." }, 405);
}
