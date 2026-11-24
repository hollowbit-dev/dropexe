// Small download helper shared by the engine, stores and fixer.
const fs = require('fs');
const fsp = fs.promises;

// Retries up to 3 times; a slow or dropped connection shouldn't fail a 250 MB store installer.
async function download(url, dest, onProgress = () => {}) {
  let err;
  for (let i = 0; i < 3; i++) {
    try { return await once(url, dest, onProgress); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
  throw new Error(`Couldn't download ${new URL(url).hostname}. Check your internet and try again.`);
}
async function once(url, dest, onProgress) {
  const { net } = require('electron');
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest + '.part');
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  await fsp.rename(dest + '.part', dest);
  return dest;
}
module.exports = { download };
