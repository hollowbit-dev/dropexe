// Real game test: node test/game.mjs <userdata> <game.exe> <broken.exe>
import { _electron as electron } from 'playwright';
import fs from 'fs';
const [ud, game, broken] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
w.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now(); const T = () => `${((Date.now() - t0) / 1000) | 0}s`;
const state = () => w.evaluate(() => window.dx.state());
const until = async (fn, ms, step = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await w.waitForTimeout(step); } return null; };
await w.waitForTimeout(1500);

// 1. drop the game
const [r] = await w.evaluate((f) => window.dx.drop([f]), game);
console.log(T(), 'drop', JSON.stringify(r));
const id = r.id;
await w.evaluate(() => window.dx.refresh());
let it = (await state()).items.find((i) => i.id === id);
console.log(T(), 'item', it.name, it.exe, 'icon:', !!it.art?.icon, 'cover:', !!it.art?.cover);

// 2. play, see it running, stop
console.log(T(), 'play', JSON.stringify(await w.evaluate((id) => window.dx.play(id), id)));
const ran = await until(async () => (await state()).items.find((i) => i.id === id)?.running, 60000);
console.log(T(), 'running:', !!ran);
await w.waitForTimeout(8000);
const still = (await state()).items.find((i) => i.id === id)?.running;
console.log(T(), 'still running after 8s:', !!still);
await w.screenshot({ path: `${ud}/game-playing.png` });
await w.evaluate((id) => window.dx.stop(id), id);
await w.waitForTimeout(4000);
console.log(T(), 'after stop running:', !!(await state()).items.find((i) => i.id === id)?.running);

// 3. Launchpad app, then open it like Spotlight would
const m = await w.evaluate((id) => window.dx.macApp(id), id);
console.log(T(), 'mac app', JSON.stringify(m), fs.existsSync(m.path + '/Contents/Resources/icon.icns') ? 'with icon' : 'NO icon');

// 4. Make it run on the working game: should stop at step 1 and ask
const fixes = [];
await w.exposeFunction('__fix', (f) => fixes.push(f));
await w.evaluate(() => window.dx.on.fix((f) => window.__fix(f)));
w.evaluate((id) => window.dx.fix(id), id);
const asked = await until(() => fixes.find((f) => f.state === 'ask'), 120000);
console.log(T(), 'fix steps seen:', fixes.map((f) => `${f.step}:${f.state}`).join(' '));
if (asked) await w.evaluate(() => window.dx.fixAnswer(true));
await until(() => fixes.find((f) => f.state === 'fixed' || f.state === 'failed'), 30000);
it = (await state()).items.find((i) => i.id === id);
console.log(T(), 'fixedWith:', it.fixedWith, JSON.stringify(it.fix));
await w.evaluate((id) => window.dx.stop(id), id);
await w.waitForTimeout(3000);

// 5. a broken program: every step should fail, then "failed"
fixes.length = 0;
const [rb] = await w.evaluate((f) => window.dx.drop([f]), broken);
console.log(T(), 'broken drop', JSON.stringify(rb));
w.evaluate((id) => window.dx.fix(id), rb.id);
await until(() => fixes.find((f) => f.state === 'failed' || f.state === 'ask'), 15 * 60000, 2000);
console.log(T(), 'broken fix:', fixes.map((f) => `${f.step || ''}:${f.state}`).join(' '));
if (fixes.find((f) => f.state === 'ask')) { await w.evaluate(() => window.dx.fixCancel()); await w.waitForTimeout(3000); }
await w.evaluate((id) => window.dx.remove(id), rb.id);
await app.close();
