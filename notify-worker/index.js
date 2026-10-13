// Internal-only Worker: called by the Pages Function via service binding. No public route.
import { EmailMessage } from "cloudflare:email";
const FROM = "tryouts@zoisports.com";
const TO = "REDACTED";
const clean = (v, n = 300) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, n);

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("no", { status: 405 });
    const a = await request.json();
    const subject = `New ZOI tryout: ${clean(a.epic_name, 40)}`;
    const body = [
      `New tryout application (#${clean(a.id)})`, "",
      `Epic: ${clean(a.epic_name)}`, `Discord: ${clean(a.discord)}`, `Region: ${clean(a.region)}`,
      `Platform: ${clean(a.platform)}`, `Age: ${clean(a.age)}`, `Role: ${clean(a.role)}`,
      `Results: ${clean(a.results_link) || "-"}`, `Clips: ${clean(a.clips_link) || "-"}`,
      `Email: ${clean(a.email) || "-"}`, "", "Why ZOI:", String(a.why ?? "").slice(0, 2000),
    ].join("\r\n");
    const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    const raw = [
      `From: ZOI Tryouts <${FROM}>`, `To: <${TO}>`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@zoisports.com>`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      b64(body).replace(/.{76}/g, "$&\r\n"),
    ].join("\r\n");
    try {
      await env.EMAIL.send(new EmailMessage(FROM, TO, raw));
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  },
};
