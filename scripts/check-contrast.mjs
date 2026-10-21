// WCAG contrast check for the running app, in light and dark.
//
//   npm run check:contrast -- [--cookies session.json] [--chromium /path/to/chrome] <url> [url…]
//
// For every element with its own text, compares the text colour with the
// background behind it (walking up through translucent layers) and fails on
// anything under 4.5:1 (3:1 for large or bold-large text). Signed-in pages
// need --cookies: a JSON array of { name, value } for the app's domain.
// Disabled controls are skipped (WCAG exempts them).
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const cookieFile = opt("--cookies");
const executablePath = opt("--chromium") ?? process.env.CHROMIUM_PATH;
const urls = args;
if (!urls.length) {
  console.error("Usage: npm run check:contrast -- [--cookies session.json] [--chromium path] <url> [url…]");
  process.exit(2);
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
if (cookieFile) {
  const host = new URL(urls[0]).hostname;
  const cookies = JSON.parse(readFileSync(cookieFile, "utf8"));
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: host, path: "/", sameSite: "Lax" })));
}
const page = await ctx.newPage();

function scan() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const bad = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || (el.offsetParent === null && cs.position !== "fixed")) continue;
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    let fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    fg = blend(fg, bg);
    const [l1, l2] = [lum(fg), lum(bg)];
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const need = size >= 24 || (parseInt(cs.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push(`${ratio.toFixed(2)}:1 (needs ${need}) <${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 50)}"`);
  }
  return [...new Set(bad)];
}

let failures = 0;
for (const url of urls) {
  for (const theme of ["light", "dark"]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(400); // let colour transitions finish
    for (const line of await page.evaluate(scan)) {
      failures++;
      console.log(`${new URL(url).pathname} [${theme}] ${line}`);
    }
  }
}
await browser.close();
console.log(failures ? `\n${failures} contrast failure${failures === 1 ? "" : "s"}` : "No contrast issues.");
process.exit(failures ? 1 : 0);
