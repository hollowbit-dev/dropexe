// Marketing screenshots at 2x (2560x1600) from a real library. node test/marketing-shots.mjs <userdata> <outdir>
import { _electron as electron } from 'playwright';
const [ud, out] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
const bw = await app.browserWindow(w);
await bw.evaluate((b) => { b.setContentSize(1280, 800); b.webContents.setZoomFactor(1); });
await w.waitForTimeout(3000);
const shot = (n) => w.screenshot({ path: `${out}/${n}.png`, scale: 'device' });
const pick = async (name) => { await w.evaluate((n) => { const c = [...document.querySelectorAll('.cover')].find((x) => x.getAttribute('aria-label') === n); c?.click(); }, name); await w.waitForTimeout(1600); };
await pick("Doki Doki Literature Club!"); await shot('dropexe-library');
await pick('Project Zomboid'); await shot('dropexe-library-2');
await pick('FNAF Plus'); await shot('dropexe-windows-game');
// Make it run, mid-way: first fix failed, second is trying
await w.evaluate(() => {
  document.getElementById('fix-title').textContent = 'Making FNAF Plus run';
  const steps = [['Metal graphics', 'DirectX 10 and 11 drawn straight with Metal. Fastest on Apple chips.', 'bad', 'Closed by itself'], ['Vulkan graphics', 'A second DirectX translator. Some games like this one better.', 'good', 'Works'], ['Classic graphics', 'Older OpenGL path. Slower, but works with many old games.', '', ''], ['Add Microsoft runtimes', 'Installs the Visual C++ files lots of games need, then tries Metal again.', '', '']];
  document.getElementById('fix-steps').innerHTML = steps.map(([b, s, c, t]) => `<li class="${c}"><span><b>${b}</b><small>${s}</small></span><span class="st">${t}</span></li>`).join('');
  document.getElementById('fix-text').textContent = 'Fixed. DropExe saved this, so Play uses it from now on.';
  document.getElementById('fix-close').textContent = 'Done';
  document.getElementById('fix-sheet').hidden = false;
});
await w.waitForTimeout(700); await shot('dropexe-make-it-run');
await w.evaluate(() => { document.getElementById('fix-sheet').hidden = true; });
await w.click('#find-btn');
for (let i = 0; i < 240 && await w.isDisabled('#import-ok'); i++) await w.waitForTimeout(500);
await w.evaluate(() => { const b = document.querySelectorAll('.import-h'); });
await w.waitForTimeout(800); await shot('dropexe-find-games');
await w.click('#import-cancel');
await w.click('.tab[data-tab="stores"]'); await w.waitForTimeout(900); await shot('dropexe-stores');
await app.close();
