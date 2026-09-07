// Dev helper: screenshot every page of a running instance. `node scripts/screenshot.mjs [baseUrl]`
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.env.OUT ?? "/tmp";
const pages = {
  overview: "/",
  tokens: "/tokens?sort=volume",
  token: "/tokens/6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
  pairs: "/pairs",
  flywheel: "/flywheel",
  launches: "/launches",
};
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
for (const [name, path] of Object.entries(pages)) {
  await pg.goto(base + path, { waitUntil: "networkidle" });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: `${out}/shot-${name}.png`, fullPage: true });
  console.log(name, "ok");
}
await b.close();
