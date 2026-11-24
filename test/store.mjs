// node test/store.mjs <userdata> <storeId> [waitSecondsAfter]
import { _electron as electron } from 'playwright';
const [ud, id, after = '40'] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
w.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await w.waitForTimeout(1500);
let last = '';
const iv = setInterval(async () => { try { const j = await w.textContent('.job-text'); if (j !== last) { last = j; console.log(((Date.now() - t0) / 1000) | 0, 's', j); } } catch {} }, 1000);
const r = await w.evaluate((id) => window.dx.addStore(id), id);
clearInterval(iv);
console.log('result', JSON.stringify(r), ((Date.now() - t0) / 1000) | 0, 's');
await w.waitForTimeout(Number(after) * 1000);
const st = await w.evaluate(() => window.dx.state());
console.log('running', JSON.stringify(st.items.filter((i) => i.running).map((i) => i.id)));
console.log('log tail:', (await w.evaluate((id) => window.dx.log('store-' + id), id)).split('\n').filter((l) => /err:|Error|error/.test(l) && !/fixme/.test(l)).slice(-8).join('\n'));
await w.evaluate((id) => window.dx.stop('store-' + id), id);
await app.close();
