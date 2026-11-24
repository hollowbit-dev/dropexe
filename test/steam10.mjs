// Get Steam through the app (Wine 10 drive) and capture its window. node test/steam10.mjs <userdata> <wine-windows tool> <png>
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
const [ud, tool, png] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
await w.waitForTimeout(1500);
const t0 = Date.now();
console.log('add', JSON.stringify(await w.evaluate(() => window.dx.addStore('steam'))), ((Date.now() - t0) / 1000) | 0, 's');
let id = null;
for (let i = 0; i < 60 && !id; i++) { await w.waitForTimeout(5000); id = execFileSync(tool).toString().split('\n').find((l) => /sign in to steam|^\d+\t\S+\twine\tSteam$/i.test(l))?.split('\t')[0]; }
console.log('window after', ((Date.now() - t0) / 1000) | 0, 's:', id);
await w.waitForTimeout(15000);
if (id) execFileSync('screencapture', ['-x', '-o', '-l', id, png]);
console.log('running', JSON.stringify((await w.evaluate(() => window.dx.state())).items.map((i) => [i.id, i.running])));
await w.evaluate(() => window.dx.stop('store-steam'));
await app.close();
