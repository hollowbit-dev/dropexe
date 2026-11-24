// Pull the biggest icon out of a Windows .exe (PE file) and save it as a PNG.
// Reads only the bytes it needs, so huge game exes are fine.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function reader(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const read = (pos, len) => {
    if (pos < 0 || pos + len > size) throw new Error('out of range');
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, pos);
    return b;
  };
  return { read, close: () => fs.closeSync(fd) };
}

function findIcon(file) {
  const r = reader(file);
  try {
    const dos = r.read(0, 64);
    if (dos.toString('latin1', 0, 2) !== 'MZ') return null;
    const pe = dos.readUInt32LE(0x3c);
    const coff = r.read(pe, 24);
    if (coff.toString('latin1', 0, 4) !== 'PE\0\0') return null;
    const nSections = coff.readUInt16LE(6);
    const optSize = coff.readUInt16LE(20);
    const opt = r.read(pe + 24, optSize);
    const magic = opt.readUInt16LE(0);
    const ddOff = magic === 0x20b ? 112 : 96;
    const resRva = opt.readUInt32LE(ddOff + 2 * 8);
    if (!resRva) return null;
    const secs = r.read(pe + 24 + optSize, nSections * 40);
    const sections = [];
    for (let i = 0; i < nSections; i++) {
      const s = secs.subarray(i * 40, i * 40 + 40);
      sections.push({ va: s.readUInt32LE(12), vsize: Math.max(s.readUInt32LE(8), s.readUInt32LE(16)), raw: s.readUInt32LE(20) });
    }
    const off = (rva) => { const s = sections.find((x) => rva >= x.va && rva < x.va + x.vsize); if (!s) throw new Error('rva'); return rva - s.va + s.raw; };
    const base = off(resRva);

    // Resource tree: type -> name/id -> language -> data entry
    const dir = (o) => {
      const h = r.read(base + o, 16);
      const n = h.readUInt16LE(12) + h.readUInt16LE(14);
      const e = r.read(base + o + 16, n * 8);
      const out = [];
      for (let i = 0; i < n; i++) {
        const name = e.readUInt32LE(i * 8), to = e.readUInt32LE(i * 8 + 4);
        out.push({ id: name & 0x80000000 ? null : name, sub: !!(to & 0x80000000), to: to & 0x7fffffff });
      }
      return out;
    };
    const leaf = (entry) => { // descend to the first data entry
      let e = entry;
      while (e.sub) e = dir(e.to)[0];
      const d = r.read(base + e.to, 16);
      return r.read(off(d.readUInt32LE(0)), d.readUInt32LE(4));
    };
    const types = dir(0);
    const group = types.find((t) => t.id === 14);
    const icons = types.find((t) => t.id === 3);
    if (!group || !icons) return null;
    const iconById = new Map(dir(icons.to).map((e) => [e.id, e]));
    // The first icon group is the one Windows shows for the exe.
    const grp = leaf(dir(group.to)[0]);
    const count = grp.readUInt16LE(4);
    let best = null;
    for (let i = 0; i < count; i++) {
      const p = 6 + i * 14;
      const w = grp[p] || 256, bits = grp.readUInt16LE(p + 6), id = grp.readUInt16LE(p + 12);
      const score = w * 100 + bits;
      if (iconById.has(id) && (!best || score > best.score)) best = { score, w, h: grp[p + 1] || 256, bits, id, colors: grp[p + 2] };
    }
    if (!best) return null;
    const data = leaf(iconById.get(best.id));
    return { data, ...best };
  } finally { r.close(); }
}

// Write <out>.png. Returns the path, or null if the exe has no icon.
async function extract(exe, out) {
  let ico;
  try { ico = findIcon(exe); } catch { return null; }
  if (!ico) return null;
  const png = out.endsWith('.png') ? out : out + '.png';
  if (ico.data.subarray(0, 4).toString('latin1') === '\x89PNG') { fs.writeFileSync(png, ico.data); return png; }
  // A classic bitmap icon: wrap it in a one-image .ico and let macOS convert it.
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = ico.w >= 256 ? 0 : ico.w; head[7] = ico.h >= 256 ? 0 : ico.h; head[8] = ico.colors; head[9] = 0;
  head.writeUInt16LE(1, 10); head.writeUInt16LE(ico.bits, 12); head.writeUInt32LE(ico.data.length, 14); head.writeUInt32LE(22, 18);
  const tmp = path.join(os.tmpdir(), `dropexe-${process.pid}-${Date.now()}.ico`);
  fs.writeFileSync(tmp, Buffer.concat([head, ico.data]));
  await new Promise((res) => execFile('/usr/bin/sips', ['-s', 'format', 'png', tmp, '--out', png], () => res()));
  fs.rmSync(tmp, { force: true });
  return fs.existsSync(png) ? png : null;
}

module.exports = { extract, findIcon };
