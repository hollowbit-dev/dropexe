// Import into the real DropExe library with the packaged app (ticks the defaults, like a user pressing Add).
import { _electron as electron } from 'playwright';
const app = await electron.launch({ executablePath: 'dist/mac-arm64/DropExe.app/Contents/MacOS/DropExe' });
const w = await app.firstWindow();
await w.waitForTimeout(2000);
// remove the test-only Cave Story (its files live in a temporary folder)
for (const it of (await w.evaluate(() => window.dx.state())).items) if (/cave story/i.test(it.name)) await w.evaluate((id) => window.dx.remove(id), it.id);
await w.click('#find-btn');
for (let i = 0; i < 240 && await w.isDisabled('#import-ok'); i++) await w.waitForTimeout(500);
await w.click('#import-ok');
await w.waitForSelector('#import-sheet', { state: 'hidden', timeout: 120000 });
await w.waitForTimeout(6000);
const st = await w.evaluate(() => window.dx.state());
console.log(st.items.length, 'items;', st.items.filter((i) => !i.art?.cover && !i.art?.icon).map((i) => i.name).join(', ') || 'all have art');
await app.close();
