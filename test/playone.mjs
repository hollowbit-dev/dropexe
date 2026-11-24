// Play one library item by name, capture its Wine window. node test/playone.mjs <userdata> <name> <tool> <png>
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
const [ud, name, tool, png] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow(); await w.waitForTimeout(1500);
const it = (await w.evaluate(() => window.dx.state())).items.find((i) => i.name === name);
console.log('play', JSON.stringify(await w.evaluate((id) => window.dx.play(id), it.id)));
await w.waitForTimeout(25000);
const wins = execFileSync(tool).toString().trim().split('\n').filter(Boolean);
console.log('windows', JSON.stringify(wins), 'running', (await w.evaluate(() => window.dx.state())).items.find((i) => i.id === it.id).running);
if (wins[0]) execFileSync('screencapture', ['-x', '-o', '-l', wins[0].split('\t')[0], png]);
await w.evaluate((id) => window.dx.stop(id), it.id);
await app.close();
