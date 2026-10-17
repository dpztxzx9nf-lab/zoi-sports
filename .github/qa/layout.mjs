// Mobile layout check: WebKit, iPhone UA. Usage: node layout.mjs <base_url> <outdir>
import { webkit, devices } from 'playwright';
import fs from 'fs';
const base = process.argv[2].replace(/\/$/, ''); const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
let paths = ['/'];
try { const sm = await (await fetch(base + '/sitemap.xml')).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  if (locs.length) paths = [...new Set(locs)]; } catch {}
const browser = await webkit.launch(); const fails = [];
for (const [w, h] of [[390, 844], [390, 664]]) for (const p of paths) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: w, height: h } });
  const page = await ctx.newPage(); await page.goto(base + p, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const r = await page.evaluate(({ h }) => {
    const hdrs = [...document.querySelectorAll('body *')].filter(e => { const s = getComputedStyle(e);
      if (!['fixed', 'sticky'].includes(s.position)) return false; const b = e.getBoundingClientRect();
      return b.top <= 1 && b.height > 0 && b.height < h / 2 && b.width > innerWidth * 0.5; });
    const hdrBottom = Math.max(0, ...hdrs.map(e => e.getBoundingClientRect().bottom));
    const bad = []; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = tw.nextNode())) { if (!n.textContent.trim()) continue; const el = n.parentElement;
      if (hdrs.some(x => x.contains(el))) continue; const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const b of rg.getClientRects()) { if (b.width < 1 || b.height < 1 || b.bottom <= 0 || b.top >= h) continue;
        let why = hdrBottom && b.top < hdrBottom ? 'underHeader' : null;
        if (!why && b.bottom > h - 100) {
          // only flag fixed/sticky, footer/nav/CTA/link/button, or pages that end within the viewport
          let fixed = false; for (let a = el; a && a !== document.body; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'fixed' || p === 'sticky') { fixed = true; break; } }
          const ui = el.closest('footer, nav, a, button, [role=button], [role=navigation], [role=contentinfo], .button, .cta, [class*="cta"]');
          const short = document.documentElement.scrollHeight <= h + 1;
          if (fixed || ui || short) why = 'bottom100' + (fixed ? '[fixed]' : ui ? `[${ui.tagName.toLowerCase()}]` : '[pageEnds]');
        }
        if (why) { bad.push(`${why}: "${n.textContent.trim().slice(0, 40)}" top=${b.top|0} bottom=${b.bottom|0}`); break; } } }
    return { hdrBottom, bad };
  }, { h });
  const slug = (p.replace(/\W+/g, '_') || '_') + `${w}x${h}`;
  const shot = `${out}/${slug}.png`; const buf = await page.screenshot({ path: shot });
  // empty band: rows of a single color in first screen, via canvas decode in page
  const band = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64;
    await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
    const dpr = img.width / innerWidth; let run = 0, max = 0, at = 0;
    for (let y = 0; y < img.height; y++) { const o = y * img.width * 4; let uni = true;
      for (let i = 0; i < img.width * 4; i += 16) if (Math.abs(d[o + i] - d[o]) + Math.abs(d[o + i + 1] - d[o + 1]) + Math.abs(d[o + i + 2] - d[o + 2]) > 12) { uni = false; break; }
      run = uni ? run + 1 : 0; if (run > max) { max = run; at = y - run + 1; } }
    return { max: Math.round(max / dpr), at: Math.round(at / dpr) }; }, buf.toString('base64'));
  const issues = [...r.bad]; if (band.max > 200) issues.push(`emptyBand: ${band.max}px at y=${band.at}`);
  console.log(`${p} ${w}x${h} header=${r.hdrBottom|0}px maxBand=${band.max}px issues=${issues.length}`);
  issues.forEach(i => console.log('  ' + i)); if (issues.length) fails.push(`${p} ${w}x${h}: ${issues.length} issue(s)`);
  await ctx.close(); }
await browser.close(); fs.writeFileSync(`${out}/result.txt`, fails.join('\n') || 'PASS');
process.exit(fails.length ? 1 : 0);
