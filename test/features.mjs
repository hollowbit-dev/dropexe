// Screenshots of the remove sheet, the menu (Retina switch) and the controller check, in the demo library.
import { _electron as electron } from 'playwright';
const out = process.argv[2];
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_DEMO: '1', DROPEXE_USERDATA: '/tmp/dropexe-demo' } });
const w = await app.firstWindow();
await w.setViewportSize({ width: 1280, height: 800 });
await w.waitForTimeout(2500);
await w.click('#more-btn'); await w.waitForTimeout(400);
await w.screenshot({ path: `${out}-menu.png` });
await w.click('[data-act="remove"]'); await w.waitForTimeout(800);
await w.screenshot({ path: `${out}-remove.png` });
await w.click('#remove-cancel');
await w.click('#pad-btn'); await w.waitForTimeout(800);
await w.screenshot({ path: `${out}-pads.png` });
await app.close();
