// Packaged app with the real data folder: setup, add a game, make its Launchpad app. node test/packaged.mjs <game.exe>
import { _electron as electron } from 'playwright';
const [game] = process.argv.slice(2);
const app = await electron.launch({ executablePath: 'dist/mac-arm64/DropExe.app/Contents/MacOS/DropExe' });
const w = await app.firstWindow();
await w.waitForTimeout(2000);
if (await w.isVisible('#setup-go')) { await w.click('#setup-go'); await w.waitForSelector('#setup', { state: 'hidden', timeout: 600000 }); console.log('engine ready'); }
const [r] = await w.evaluate((f) => window.dx.drop([f]), game);
console.log('drop', JSON.stringify(r));
await w.waitForTimeout(1500);
console.log('mac app', JSON.stringify(await w.evaluate((id) => window.dx.macApp(id), r.id)));
await w.screenshot({ path: '/tmp/dropexe-packaged.png' });
await app.close();
