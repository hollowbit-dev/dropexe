import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
const [ud, tool, png] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
await w.waitForTimeout(1500);
const t0 = Date.now();
console.log('play', JSON.stringify(await w.evaluate(() => window.dx.play('store-steam'))));
let id = null;
for (let i = 0; i < 72 && !id; i++) { await w.waitForTimeout(5000); id = execFileSync(tool).toString().split('\n').find((l) => /sign in to steam/i.test(l))?.split('\t')[0]; }
console.log('sign-in window after', ((Date.now() - t0) / 1000) | 0, 's:', id);
await w.waitForTimeout(15000);
if (id) execFileSync('screencapture', ['-x', '-o', '-l', id, png]);
await w.evaluate(() => window.dx.stop('store-steam'));
await app.close();
