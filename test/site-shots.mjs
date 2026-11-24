// Website screenshots from the demo library (popular games, Steam's public art). node test/site-shots.mjs <outdir>
import { _electron as electron } from 'playwright';
const out = process.argv[2];
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_DEMO: '1', DROPEXE_USERDATA: '/tmp/dropexe-demo' } });
const w = await app.firstWindow();
const bw = await app.browserWindow(w);
await bw.evaluate((b) => b.setContentSize(1280, 800));
await w.waitForTimeout(4000);
const pick = async (n) => { await w.evaluate((n) => [...document.querySelectorAll('.cover')].find((x) => x.getAttribute('aria-label') === n)?.click(), n); await w.waitForTimeout(2500); };
await pick('Hollow Knight'); await w.screenshot({ path: `${out}/dropexe-library.png` });
await pick('Stardew Valley'); await w.screenshot({ path: `${out}/dropexe-windows-game.png` });
await app.close();
