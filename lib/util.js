'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function id(prefix) { return prefix + '_' + crypto.randomBytes(5).toString('hex'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, obj) {
  const tmp = p + '.tmp';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}
function toDataUrl(file) {
  const b = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
  return `data:image/${mime};base64,${b.toString('base64')}`;
}
function findFont() {
  const cands = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}
function sanitizeName(s) {
  return String(s || 'x').replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 24) || 'x';
}
module.exports = { id, sleep, readJSON, writeJSON, readBody, downloadTo, toDataUrl, findFont, sanitizeName };
