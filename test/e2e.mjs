// Real run: set up the engine, add Steam, check it lands in the library. node test/e2e.mjs <userdata>
import { _electron as electron } from 'playwright';
const ud = process.argv[2];
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
w.on('console', (m) => console.log('[page]', m.text()));
const t0 = Date.now(); const s = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
if (await w.isVisible('#setup-go')) {
  await w.click('#setup-go');
  await w.waitForSelector('#setup', { state: 'hidden', timeout: 300000 });
  console.log('engine ready', s());
}
await w.click('.tab[data-tab="stores"]');
await w.click('.store button:has-text("Get Steam")');
await w.waitForFunction(() => [...document.querySelectorAll('.store')].some((e) => e.textContent.includes('Open Steam')), null, { timeout: 600000 });
console.log('steam added', s());
const st = await w.evaluate(() => window.dx.state());
console.log(JSON.stringify(st.items.map((i) => [i.id, i.name, i.kind])));
await w.click('.tab[data-tab="library"]');
await w.waitForTimeout(1500);
await w.screenshot({ path: `${ud}/after-steam.png` });
// Steam was started by add-store; wait for it to be seen running.
await w.waitForTimeout(40000);
console.log('running?', JSON.stringify((await w.evaluate(() => window.dx.state())).items.map((i) => [i.id, i.running])));
await w.screenshot({ path: `${ud}/steam-running.png` });
await w.evaluate(() => window.dx.stop('store-steam'));
await app.close();
