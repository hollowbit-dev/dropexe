// Screenshots of the Graphics menu with Apple D3DMetal and the licence sheet, in the demo library.
import { _electron as electron } from 'playwright';
const out = process.argv[2];
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_DEMO: '1', DROPEXE_USERDATA: '/tmp/dropexe-demo' } });
const w = await app.firstWindow();
await w.setViewportSize({ width: 1280, height: 800 });
await w.waitForTimeout(2500);
await w.click('#more-btn'); await w.waitForTimeout(400);
await w.screenshot({ path: `${out}-menu.png` });
await w.click('[data-act="graphics-d3dmetal"]'); await w.waitForTimeout(600);
await w.screenshot({ path: `${out}-sheet.png` });
await app.close();
