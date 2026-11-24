// Drop an installer: it runs, DropExe finds what it added and offers it. node test/installer.mjs <userdata> <installer.exe>
import { _electron as electron } from 'playwright';
const [ud, file] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud, DROPEXE_TEST_SILENT: '1' } });
const w = await app.firstWindow();
await w.waitForTimeout(1500);
const t0 = Date.now();
const [r] = await w.evaluate((f) => window.dx.drop([f]), file);
console.log(((Date.now() - t0) / 1000) | 0, 's', JSON.stringify(r).slice(0, 600));
if (r.choose) {
  const added = await w.evaluate((p) => window.dx.pick([p]), r.choose[0]);
  console.log('picked', JSON.stringify(added));
  const it = (await w.evaluate(() => window.dx.state())).items.find((i) => i.id === added[0].id);
  console.log('item', it.name, it.exe, 'icon', !!it.art?.icon);
  console.log('play', JSON.stringify(await w.evaluate((id) => window.dx.play(id), it.id)));
  await w.waitForTimeout(12000);
  console.log('running', (await w.evaluate(() => window.dx.state())).items.find((i) => i.id === it.id).running);
  await w.screenshot({ path: `${ud}/installer.png` });
  await w.evaluate((id) => window.dx.stop(id), it.id);
}
await app.close();
