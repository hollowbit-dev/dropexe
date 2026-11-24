import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const o = process.argv[2];
await p.goto('http://localhost:8765/dropexe/'); await p.waitForTimeout(2500); await p.screenshot({ path: o + '1.png' });
await p.evaluate(() => window.scrollTo(0, 1400)); await p.waitForTimeout(1500); await p.screenshot({ path: o + '2.png' });
await b.close();
