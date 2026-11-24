/* DropExe renderer: library shelf, stores, drop-to-add, Make it run. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const S = { items: [], stores: [], steps: [], sel: null, tab: 'library', jobs: new Map(), fixing: null, engine: null, playing: new Set() };

const fileUrl = (p) => (!p ? '' : /^(https?:|stores\/)/.test(p) ? p : 'file://' + p.split('/').map(encodeURIComponent).join('/'));
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
function hslRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `${f(0)} ${f(8)} ${f(4)}`;
}
const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16 & 255} ${n >> 8 & 255} ${n & 255}`; };
// Store logos ship with the app (taken from each store's own installer); anything else uses its exe's icon.
const STORE_LOGOS = new Set(['steam', 'epic', 'gog', 'battlenet', 'ubisoft', 'ea']);
const storeLogo = (id) => (STORE_LOGOS.has(id) ? `stores/${id}.png` : null);
const iconOf = (it) => it.art?.icon || (it.kind === 'store' ? storeLogo(it.storeId) : null);
const colorOf = (it) => (it.color ? hexRgb(it.color) : hslRgb(hue(it.name), 55, 52));

function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

// ---------------------------------------------------------------- tint from cover art
// Average the cover's colours (skipping near-black/near-white) and use that as the window's tint.
const tintCache = new Map();
function tintFrom(img, key) {
  if (tintCache.has(key)) return tintCache.get(key);
  try {
    const c = document.createElement('canvas'); c.width = 24; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 36);
    const d = x.getImageData(0, 0, 24, 36).data;
    let r = 0, g = 0, b = 0, n = 0, best = null, bestSat = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx < 40 || mn > 225) continue;
      const sat = (mx - mn) / mx;
      r += R; g += G; b += B; n++;
      if (sat * mx > bestSat) { bestSat = sat * mx; best = [R, G, B]; }
    }
    if (!n) return null;
    // Lean towards the most vivid pixel so the tint has some life.
    const mix = (a, v) => Math.round(a / n * 0.4 + v * 0.6);
    const rgb = best ? `${mix(r, best[0])} ${mix(g, best[1])} ${mix(b, best[2])}` : `${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)}`;
    tintCache.set(key, rgb);
    return rgb;
  } catch { return null; }
}

// ---------------------------------------------------------------- backdrop
let bdFront = 'a';
function setBackdrop(url, mode = '') {
  const key = url + '|' + mode;
  const front = $(`.bd-${bdFront}`);
  if (front.dataset.key === key) return;
  const back = $(`.bd-${bdFront === 'a' ? 'b' : 'a'}`);
  back.dataset.key = key;
  back.className = `bd bd-${bdFront === 'a' ? 'b' : 'a'} ${mode}`;
  back.style.backgroundImage = url ? `url("${url}")` : 'none';
  void back.offsetWidth;
  back.classList.add('on'); front.classList.remove('on');
  bdFront = bdFront === 'a' ? 'b' : 'a';
}

// ---------------------------------------------------------------- library
function ordered() {
  const games = S.items.filter((i) => i.kind !== 'store').sort((a, b) => (b.lastPlayed || b.addedAt || 0) - (a.lastPlayed || a.addedAt || 0));
  const stores = S.items.filter((i) => i.kind === 'store');
  return [...games, ...stores];
}

function coverEl(it) {
  const b = document.createElement('button');
  b.className = 'cover'; b.dataset.id = it.id; b.setAttribute('role', 'option');
  b.setAttribute('aria-label', it.name);
  b.style.setProperty('--c', colorOf(it));
  if (it.art?.cover) {
    const img = new Image();
    img.src = fileUrl(it.art.cover); img.alt = ''; img.draggable = false; img.className = 'art';
    img.onload = () => { const t = tintFrom(img, it.id); if (t) { it._tint = t; if (S.sel === it.id) applyTint(it); } };
    b.append(img);
  } else {
    b.classList.add('iconic');
    const icon = iconOf(it);
    if (icon) {
      const img = new Image();
      img.src = fileUrl(icon); img.alt = ''; img.draggable = false; img.className = 'ico';
      img.onload = () => { if (img.naturalWidth < 64) img.classList.add('pixel'); const t = tintFrom(img, it.id); if (t) { it._tint = t; b.style.setProperty('--c', t); if (S.sel === it.id) applyTint(it); } };
      b.append(img);
    } else {
      const m = document.createElement('span'); m.className = 'mono'; m.textContent = it.name.trim()[0]?.toUpperCase() || '?'; b.append(m);
    }
    const n = document.createElement('span'); n.className = 'name'; n.textContent = it.name; b.append(n);
  }
  if (it.running || S.playing.has(it.id)) { const t = document.createElement('span'); t.className = 'tag live'; t.textContent = it.kind === 'store' ? 'Open' : 'Playing'; b.append(t); }
  else if (it.installing) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Installing in Steam'; b.append(t); }
  b.addEventListener('click', () => select(it.id, true));
  b.addEventListener('dblclick', () => playSel());
  return b;
}

function renderShelf(newId) {
  const list = ordered();
  $('#empty').hidden = list.length > 0;
  $('#hero').hidden = !list.length;
  $('.shelf-wrap').hidden = !list.length;
  const shelf = $('#shelf');
  shelf.replaceChildren(...list.map(coverEl));
  if (newId) $(`.cover[data-id="${CSS.escape(newId)}"]`)?.classList.add('new');
  if (!list.find((i) => i.id === S.sel)) S.sel = list[0]?.id || null;
  if (S.sel) select(S.sel, false);
  else setBackdrop('');
}

function applyTint(it) {
  document.documentElement.style.setProperty('--tint', it._tint || colorOf(it));
}

const fmtTime = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`; };
const GRAPHICS = { dxmt: 'Metal graphics', dxvk: 'Vulkan graphics', wined3d: 'Classic graphics' };

// Scroll only the shelf (scrollIntoView would also slide the whole page sideways).
function scrollShelfTo(c) {
  if (!c) return;
  const shelf = $('#shelf');
  const pad = parseFloat(getComputedStyle(shelf).paddingLeft);
  const left = c.offsetLeft;
  if (left - pad < shelf.scrollLeft) shelf.scrollTo({ left: left - pad, behavior: 'smooth' });
  else if (left + c.offsetWidth + pad > shelf.scrollLeft + shelf.clientWidth) shelf.scrollTo({ left: left + c.offsetWidth + pad - shelf.clientWidth, behavior: 'smooth' });
}

function select(id, scroll) {
  const it = S.items.find((i) => i.id === id);
  if (!it) return;
  const changed = S.sel !== id;
  S.sel = id;
  $$('.cover').forEach((c) => { const on = c.dataset.id === id; c.classList.toggle('sel', on); c.setAttribute('aria-selected', on); });
  if (scroll) scrollShelfTo($(`.cover[data-id="${CSS.escape(id)}"]`));
  const title = $('#hero-title');
  if (changed || title.textContent !== it.name) {
    title.textContent = it.name;
    title.classList.remove('swap'); void title.offsetWidth; title.classList.add('swap');
  }
  const kind = it.kind === 'store' ? 'Game store' : it.source === 'steam' ? 'Steam' : it.source === 'epic' ? 'Epic Games' : 'Windows program';
  const kIcon = it.kind === 'store' ? iconOf(it) : it.source === 'steam' ? storeLogo('steam') : null;
  $('#hero-kind-text').textContent = kind;
  $('#hero-kind-icon').hidden = !kIcon;
  if (kIcon) $('#hero-kind-icon').src = fileUrl(kIcon);
  $('#hero-kind').classList.toggle('has-icon', !!kIcon);
  const meta = [];
  if (it.playMs > 60000) meta.push(`Played ${fmtTime(it.playMs)}`);
  if (it.fix?.graphics) meta.push(GRAPHICS[it.fix.graphics]);
  if (it.fixedWith) meta.push('Fixed by Make it run');
  if (it.macApp) meta.push('In Launchpad');
  $('#hero-meta').replaceChildren(...meta.map((m) => { const li = document.createElement('li'); li.textContent = m; return li; }));
  const icon = iconOf(it);
  if (it.art?.hero || it.art?.cover) setBackdrop(fileUrl(it.art.hero || it.art.cover));
  else setBackdrop(icon ? fileUrl(icon) : '', 'icon');
  if (changed) { const c = $(`.cover[data-id="${CSS.escape(id)}"]`); c?.classList.remove('shine'); void c?.offsetWidth; c?.classList.add('shine'); }
  applyTint(it);
  updatePlay();
  const mac = $('#mac-btn');
  $('span', mac).textContent = it.macApp ? 'Show in Finder' : 'Add to Launchpad';
  $('#fix-btn').hidden = it.kind === 'store' && it.storeId === 'steam' && false;
}

function updatePlay() {
  const it = S.items.find((i) => i.id === S.sel);
  if (!it) return;
  const live = it.running || S.playing.has(it.id);
  const b = $('#play-btn');
  $('span', b).textContent = live ? 'Stop' : it.kind === 'store' ? `Open ${it.name}` : 'Play';
  $('svg', b).innerHTML = live ? '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/>' : '<path d="M4 2.6v10.8a.8.8 0 0 0 1.2.7l8.6-5.4a.8.8 0 0 0 0-1.4L5.2 1.9A.8.8 0 0 0 4 2.6Z" fill="currentColor"/>';
  b.classList.toggle('playing', live);
  b.disabled = !!it.installing;
}

async function playSel() {
  const it = S.items.find((i) => i.id === S.sel);
  if (!it) return;
  if (it.running || S.playing.has(it.id)) { await dx.stop(it.id); S.playing.delete(it.id); updatePlay(); return; }
  const b = $('#play-btn');
  $('span', b).textContent = 'Starting…'; b.disabled = true;
  const r = await dx.play(it.id);
  b.disabled = false;
  if (r && r.ok === false) { toast(r.error, 'error'); updatePlay(); return; }
  setTimeout(updatePlay, 400);
}

// ---------------------------------------------------------------- stores
function renderStores() {
  const g = $('#stores-grid');
  g.replaceChildren(...S.stores.map((s) => {
    const el = document.createElement('div');
    el.className = 'store'; el.style.setProperty('--c', hexRgb(s.color));
    const busy = S.jobs.get(`store-${s.id}`);
    const inst = S.items.find((i) => i.id === `store-${s.id}`);
    const logo = inst?.art?.icon || storeLogo(s.id);
    el.innerHTML = `${logo ? '<img class="store-logo" alt="">' : '<span class="store-logo mono" aria-hidden="true"></span>'}<div><h2 class="store-name"></h2><p class="store-works ${s.broken ? 'no' : /click/i.test(s.works) ? 'meh' : 'good'}"></p></div><div class="store-row"></div>`;
    if (logo) $('.store-logo', el).src = fileUrl(logo); else $('.store-logo', el).textContent = s.name[0];
    $('.store-name', el).textContent = s.name;
    $('.store-works', el).textContent = s.works;
    const row = $('.store-row', el);
    const btn = document.createElement('button');
    if (s.added) { btn.className = 'btn glass'; btn.textContent = `Open ${s.name}`; btn.onclick = () => { S.sel = `store-${s.id}`; switchTab('library'); select(S.sel, true); playSel(); }; }
    else if (busy) { btn.className = 'btn glass'; btn.disabled = true; btn.textContent = busy.text; }
    else if (s.broken) { btn.className = 'btn glass'; btn.disabled = true; btn.textContent = 'Not available yet'; btn.title = s.broken; const why = document.createElement('p'); why.className = 'store-why'; why.textContent = s.broken; row.before(why); }
    else { btn.className = 'btn primary'; btn.textContent = `Get ${s.name}`; btn.onclick = () => addStore(s.id); }
    row.append(btn);
    return el;
  }));
}

async function addStore(id) {
  const s = S.stores.find((x) => x.id === id);
  S.jobs.set(`store-${id}`, { text: 'Starting' });
  renderStores();
  const r = await dx.addStore(id);
  S.jobs.delete(`store-${id}`);
  if (r.ok) { s.added = true; toast(`${s.name} is ready. Sign in and install games; they appear in Library.`); S.sel = r.id; }
  else toast(r.error || `Couldn't add ${s.name}.`, 'error');
  renderStores();
}

function switchTab(tab) {
  S.tab = tab;
  $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $('#library').hidden = tab !== 'library';
  $('#stores').hidden = tab !== 'stores';
  $('.foot').hidden = tab !== 'library';
  if (tab === 'stores') { renderStores(); setBackdrop('', 'none'); }
  else { const it = S.items.find((i) => i.id === S.sel); if (it) select(it.id, false); }
}

// ---------------------------------------------------------------- dropping files
let dragDepth = 0;
const dragFiles = (e) => [...(e.dataTransfer?.items || [])].filter((i) => i.kind === 'file');
function dragUi(on, bad) {
  document.body.classList.toggle('dragging', on);
  $('#dropzone').hidden = !on;
  $('#dropzone').classList.toggle('bad', !!bad);
  $('#slot-name').textContent = bad ? 'Only .exe and .msi' : 'Drop to add';
  $('#drop-text').textContent = bad ? 'DropExe runs Windows programs. Drop an .exe or an installer.' : 'Games, apps and installers. DropExe works out the rest.';
  let slot = $('.cover.slot');
  if (on && !slot) {
    if (S.tab !== 'library') switchTab('library');
    slot = document.createElement('div'); slot.className = 'cover slot'; slot.innerHTML = '<span>+</span>';
    $('#shelf').prepend(slot); $('#shelf').scrollTo({ left: 0, behavior: 'smooth' });
    requestAnimationFrame(() => requestAnimationFrame(() => slot.classList.add('open')));
  }
  if (!on && slot) { slot.classList.remove('open'); setTimeout(() => slot.remove(), 350); }
}
window.addEventListener('dragenter', (e) => {
  if (!dragFiles(e).length || !S.engine?.installed) return;
  e.preventDefault();
  if (dragDepth++ === 0) dragUi(true);
});
window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dragUi(false); } });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  const files = [...e.dataTransfer.files].map((f) => dx.pathFor(f)).filter(Boolean);
  const ok = files.filter((f) => /\.(exe|msi)$/i.test(f));
  if (!ok.length) { dragUi(true, true); setTimeout(() => dragUi(false), 1400); return; }
  dragUi(false);
  addFiles(ok);
});

async function addFiles(files) {
  switchTab('library');
  const results = await dx.drop(files);
  let last = null;
  for (const r of results) {
    if (!r.ok) toast(r.error, 'error');
    else if (r.choose) { await choose(r.choose); }
    else { last = r.id; if (r.existed) toast('That one is already in your library.'); }
  }
  if (last) { S.sel = last; await reload(last); }
}

function choose(list) {
  return new Promise((resolve) => {
    const box = $('#picks');
    box.replaceChildren(...list.map((c, i) => {
      const l = document.createElement('label'); l.className = 'pick';
      l.innerHTML = `<input type="checkbox"><span><b></b><small></small></span>`;
      $('input', l).checked = i === 0; $('input', l).dataset.i = i;
      $('b', l).textContent = c.name; $('small', l).textContent = `${c.exe}, ${(c.size / 1048576).toFixed(c.size > 1048576 * 10 ? 0 : 1)} MB`;
      return l;
    }));
    $('#pick-sheet').hidden = false;
    $('#pick-ok').onclick = async () => {
      const picks = $$('input:checked', box).map((x) => list[Number(x.dataset.i)]);
      $('#pick-sheet').hidden = true;
      const r = await dx.pick(picks);
      if (r[0]?.id) { S.sel = r[0].id; await reload(r[0].id); }
      resolve();
    };
    $('#pick-cancel').onclick = () => { $('#pick-sheet').hidden = true; resolve(); };
  });
}

// ---------------------------------------------------------------- Make it run
function openFix(it) {
  S.fixing = it.id;
  $('#fix-title').textContent = `Making ${it.name} run`;
  $('#fix-text').textContent = 'DropExe tries one change at a time and keeps the first one that works. The game may open and close a few times.';
  $('#fix-steps').replaceChildren(...S.steps.map((s) => {
    const li = document.createElement('li'); li.dataset.step = s.id;
    li.innerHTML = '<span><b></b><small></small></span><span class="st"></span>';
    $('b', li).textContent = s.label; $('small', li).textContent = s.detail;
    return li;
  }));
  $('#fix-ask').hidden = true;
  $('#fix-close').textContent = 'Stop trying';
  $('#fix-sheet').hidden = false;
  dx.fix(it.id);
}
const FIX_TEXT = { trying: 'Trying', prep: 'Installing', crashed: 'Closed by itself', nothing: "Didn't open", ask: 'Stayed open', fixed: 'Works', cancelled: '' };
function onFix(f) {
  if (f.id !== S.fixing) return;
  if (f.state === 'failed' || f.state === 'cancelled') {
    $('#fix-ask').hidden = true;
    if (f.state === 'failed') {
      $('#fix-text').textContent = 'Nothing on the list got it running. Some games need parts of Windows that no Mac tool can copy yet, often anti-cheat or DirectX 12.';
      $('#fix-close').textContent = 'Close';
    } else $('#fix-sheet').hidden = true;
    return;
  }
  const li = $(`#fix-steps li[data-step="${f.step}"]`);
  if (!li) return;
  li.className = { trying: 'trying', prep: 'trying', crashed: 'bad', nothing: 'bad', ask: 'trying', fixed: 'good' }[f.state] || '';
  $('.st', li).textContent = FIX_TEXT[f.state] || '';
  $('#fix-ask').hidden = f.state !== 'ask';
  if (f.state === 'fixed') {
    $('#fix-text').textContent = 'Fixed. DropExe saved this, so Play uses it from now on.';
    $('#fix-close').textContent = 'Done';
    reload();
  }
}
$('#fix-yes').onclick = () => { $('#fix-ask').hidden = true; dx.fixAnswer(true); };
$('#fix-no').onclick = () => { $('#fix-ask').hidden = true; dx.fixAnswer(false); };
$('#fix-close').onclick = () => { if ($('#fix-close').textContent === 'Stop trying') dx.fixCancel(); $('#fix-sheet').hidden = true; S.fixing = null; };

// ---------------------------------------------------------------- more menu
function openMenu(anchor) {
  const it = S.items.find((i) => i.id === S.sel);
  if (!it) return;
  const m = $('#menu');
  const g = it.fix?.graphics || 'dxmt';
  $$('[data-act^="graphics-"]', m).forEach((b) => b.classList.toggle('on', b.dataset.act === `graphics-${g}`));
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const h = m.offsetHeight;
  m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 12)}px`;
  m.style.top = `${r.top - h - 8 > 10 ? r.top - h - 8 : r.bottom + 8}px`;
  $('button', m).focus();
}
document.addEventListener('mousedown', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu') && !e.target.closest('#more-btn')) $('#menu').hidden = true; });
$('#menu').addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  $('#menu').hidden = true;
  const it = S.items.find((i) => i.id === S.sel);
  if (!it) return;
  if (act === 'rename') renameInline(it);
  else if (act.startsWith('graphics-')) { await dx.setGraphics(it.id, act.slice(9)); toast(`${it.name} now uses ${GRAPHICS[act.slice(9)].toLowerCase()}.`); }
  else if (act === 'drive') dx.openDrive(it.id);
  else if (act === 'log') { $('#log-text').textContent = (await dx.log(it.id)) || 'Nothing yet. Press Play first.'; $('#log-sheet').hidden = false; }
  else if (act === 'remove') { await dx.remove(it.id); toast(it.kind === 'store' ? `${it.name} removed from the library. Its games and drive are kept.` : `${it.name} removed. Its files are untouched.`); }
});
function renameInline(it) {
  const t = $('#hero-title');
  t.contentEditable = 'plaintext-only'; t.focus();
  document.getSelection().selectAllChildren(t);
  const done = (save) => { t.contentEditable = 'false'; t.onkeydown = t.onblur = null; if (save) dx.rename(it.id, t.textContent); else t.textContent = it.name; };
  t.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
  t.onblur = () => done(true);
}
$('#log-close').onclick = () => { $('#log-sheet').hidden = true; };

// ---------------------------------------------------------------- setup
async function setup() {
  $('#setup').hidden = false;
  $('#setup-go').onclick = async () => {
    $('#setup-go').hidden = true; $('#setup-bar').hidden = false;
    const r = await dx.installEngine();
    if (!r.ok) {
      $('#setup-step').textContent = `${r.error} Check your internet and try again.`;
      $('#setup-go').hidden = false; $('#setup-go').textContent = 'Try again';
      return;
    }
    S.engine.installed = true;
    $('#setup').hidden = true;
    renderShelf();
  };
}
dx.on.engine((s) => {
  $('#setup-bar i').style.width = `${Math.round(s.progress * 100)}%`;
  $('#setup-step').textContent = s.step === 'rosetta' ? 'Asking macOS for Rosetta, so Windows programs can run on Apple chips'
    : s.step === 'download' ? `Downloading the Windows engine, ${Math.round(s.progress * 100)}%`
      : s.step === 'unpack' ? 'Unpacking' : 'Ready';
});

// ---------------------------------------------------------------- jobs, live updates
dx.on.job((j) => {
  if (j.done) S.jobs.delete(j.id); else S.jobs.set(j.id, j);
  const cur = [...S.jobs.values()].pop();
  $('#job').hidden = !cur;
  if (cur) { $('.job-text').textContent = cur.text; $('.job-bar i').style.width = `${Math.round((cur.progress || 0) * 100)}%`; }
  if (S.tab === 'stores') renderStores();
});
dx.on.library((items) => { S.items = items; for (const i of items) if (!i.running) S.playing.delete(i.id); renderShelf(); });
dx.on.playing(({ id }) => { S.playing.add(id); renderShelf(); });
dx.on.fix(onFix);
dx.on.toast((t) => toast(t.text, t.kind));
dx.on.openFiles((files) => { if (S.engine?.installed) addFiles(files); else toast('Set up DropExe first, then open that file again.'); });
dx.on.update((u) => {
  if (u.state !== 'available') return;
  const el = $('#update'); el.hidden = false;
  el.innerHTML = 'DropExe <span></span> is out. <button>Download</button>';
  $('span', el).textContent = u.version;
  $('button', el).onclick = () => dx.openUpdate(u.url);
});

async function reload(newId) {
  S.items = await dx.refresh();
  renderShelf(newId);
}

// ---------------------------------------------------------------- wiring
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('[data-goto="stores"]').onclick = () => switchTab('stores');
$('[data-store="steam"]').onclick = () => { switchTab('stores'); addStore('steam'); };
$('#play-btn').onclick = playSel;
$('#fix-btn').onclick = () => { const it = S.items.find((i) => i.id === S.sel); if (it) openFix(it); };
$('#mac-btn').onclick = async () => {
  const it = S.items.find((i) => i.id === S.sel);
  if (!it) return;
  if (it.macApp) return dx.showMacApp(it.id);
  const r = await dx.macApp(it.id);
  if (r.ok) toast(`${it.name} is in Launchpad and Spotlight now.`);
};
$('#more-btn').onclick = (e) => openMenu(e.currentTarget);
$('#add-btn').onclick = async () => { const f = await dx.chooseFiles(); if (f.length) addFiles(f); };
$('#by').onclick = () => window.open('https://hollowbit.dev/');

document.addEventListener('keydown', (e) => {
  if (e.target.isContentEditable || !$('#fix-sheet').hidden || !$('#pick-sheet').hidden) return;
  if (e.key === 'Escape') { $('#menu').hidden = true; $('#log-sheet').hidden = true; }
  if (S.tab !== 'library' || !$('#menu').hidden) return;
  const list = ordered(); const i = list.findIndex((x) => x.id === S.sel);
  if (e.key === 'ArrowRight' && i < list.length - 1) { e.preventDefault(); select(list[i + 1].id, true); }
  if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); select(list[i - 1].id, true); }
  if (e.key === 'Enter' && document.activeElement?.classList.contains('cover')) { e.preventDefault(); playSel(); }
});

(async function start() {
  const st = await dx.state();
  Object.assign(S, { items: st.items, stores: st.stores, steps: st.steps, engine: st.engine });
  $('#ver').textContent = st.version;
  if (!st.engine.installed) setup();
  if (st.engine.installed) S.items = await dx.refresh();
  renderShelf();
})();
window.__dragUi = (on, bad) => dragUi(on, bad); // used by test/shots.mjs
