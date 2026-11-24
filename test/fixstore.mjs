// Make it run on stores, capturing the Wine windows whenever a step keeps the program open.
// node test/fixstore.mjs <userdata> <wine-windows tool> <outdir> <id>...
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
const [ud, tool, out, ...ids] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
await w.waitForTimeout(1500);
const fixes = [];
await w.exposeFunction('__fix', (f) => fixes.push(f));
await w.evaluate(() => window.dx.on.fix((f) => window.__fix(f)));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await w.waitForTimeout(1000); } return null; };
for (const id of ids) {
  fixes.length = 0;
  const t0 = Date.now();
  w.evaluate((id) => window.dx.fix(id), id);
  let n = 0;
  for (;;) {
    const f = await until(() => fixes.find((x) => ['ask', 'failed', 'cancelled', 'fixed'].includes(x.state) && !x.seen), 20 * 60000);
    if (!f) { console.log(id, 'timeout'); break; }
    f.seen = true;
    if (f.state !== 'ask') break;
    await w.waitForTimeout(15000); // let the window settle
    const wins = execFileSync(tool).toString().trim().split('\n').filter(Boolean);
    console.log(id, `step ${f.step} stayed open after ${((Date.now() - t0) / 1000) | 0}s; windows:`, JSON.stringify(wins));
    for (const line of wins.slice(0, 2)) { const wid = line.split('\t')[0]; execFileSync('screencapture', ['-x', '-o', '-l', wid, `${out}/${id}-${f.step}-${n++}.png`]); }
    await w.evaluate(() => window.dx.fixAnswer(true));
  }
  console.log(id, 'result:', fixes.map((f) => `${f.step || ''}:${f.state}`).join(' '));
  await w.evaluate((id) => window.dx.stop(id), id);
  await w.waitForTimeout(3000);
}
await app.close();
