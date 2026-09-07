// Dev helper: screenshot the viewport at a given text anchor. node scripts/shot-section.mjs "<text>" <out.png> [baseUrl]
import { chromium } from "playwright";
const [text, out, base = "http://localhost:3000"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await pg.goto(base + "/", { waitUntil: "networkidle" });
await pg.waitForTimeout(800);
const el = pg.locator(`text=${text}`).first();
await el.scrollIntoViewIfNeeded();
await pg.evaluate(() => window.scrollBy(0, -60));
await pg.waitForTimeout(300);
await pg.screenshot({ path: out });
await b.close();
