// Demo library for screenshots (DROPEXE_DEMO=1). Touches nothing; art is cached to the demo data folder.
const path = require('path');
const fs = require('fs');
const art = (id) => ({ logo: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/logo.png`, cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`, hero: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg` });
const H = 3600e3;
const games = [
  ['Hades', 1145360, 31 * H, 'dxmt'],
  ['Hollow Knight', 367520, 54 * H, 'dxmt'],
  ['Stardew Valley', 413150, 120 * H, 'wined3d'],
  ['Portal 2', 620, 12 * H, 'dxvk'],
  ['Cuphead', 268910, 9 * H, 'dxmt'],
  ['Celeste', 504230, 22 * H, 'dxmt'],
  ['Terraria', 105600, 80 * H, 'dxmt'],
  ['Slay the Spire', 646570, 44 * H, 'dxmt'],
];
function view(root) {
  const now = Date.now();
  const items = games.map(([name, id, playMs, g], i) => ({
    id: `steam-${id}`, kind: 'game', source: 'steam', name, bottle: 'steam', steamAppId: String(id),
    art: art(id), playMs, lastPlayed: now - i * 86400e3, fix: { graphics: g }, fixedWith: i === 3 ? 'dxvk' : null, macApp: i < 2, running: false, canGptk: true,
  }));
  const fx = path.join(__dirname, '..', 'test', 'fixtures');
  items.push({ id: 'app-cave', kind: 'game', source: 'drop', name: 'Cave Story', bottle: 'apps', art: { icon: path.join(fx, 'cave.png') }, playMs: 2 * H, lastPlayed: now - 20 * 86400e3, fix: { graphics: 'wined3d' } });
  items.push({ id: 'app-npp', kind: 'app', source: 'drop', name: 'Notepad++', bottle: 'apps', art: { icon: path.join(fx, 'npp.png') }, playMs: 0, lastPlayed: now - 30 * 86400e3, fix: { graphics: 'dxmt' } });
  items.push({ id: 'store-steam', kind: 'store', storeId: 'steam', name: 'Steam', color: '#1b9cf2', art: {}, fix: { graphics: 'dxmt' } });
  items.push({ id: 'store-epic', kind: 'store', storeId: 'epic', name: 'Epic Games', color: '#e6e6e6', art: {}, fix: { graphics: 'dxmt' } });
  return items;
}
module.exports = { view };
