import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: process.argv[2] } });
const w = await app.firstWindow(); await w.waitForTimeout(1500);
for (const it of (await w.evaluate(() => window.dx.state())).items) console.log(it.name, '->', JSON.stringify(await w.evaluate((id) => window.dx.removeInfo(id), it.id)));
await app.close();
