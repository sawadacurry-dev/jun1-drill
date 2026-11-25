// 単語CSV + 例文ファイル → app/words.js を作り、例文をチェックする
// 使い方: node tools/build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const CSV = path.join(ROOT, '準一級単語一覧.csv');
const SRC = path.join(ROOT, 'data', 'sentences');
const OUT = path.join(ROOT, 'app', 'words.js');

const words = fs.readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
  const [no, word, ...rest] = line.split(',');
  return { no: Number(no), word: word.trim(), meaning: rest.join(',').trim() };
});

const sentences = new Map();
const problems = [];
for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.tsv')).sort()) {
  fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const [no, en, ja] = line.split('\t');
    const n = Number(no);
    if (!n || !en || !ja) { problems.push(`${f}:${i + 1} 列が足りません`); return; }
    if (sentences.has(n)) problems.push(`No.${n} が重複しています (${f})`);
    sentences.set(n, { en: en.trim(), ja: ja.trim() });
  });
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const out = [];
let missing = 0;
for (const w of words) {
  const s = sentences.get(w.no);
  if (!s) { missing++; continue; }
  const blanks = s.en.match(/\[([^\]]+)\]/g) || [];
  if (blanks.length !== 1) problems.push(`No.${w.no} ${w.word}: 英文の [ ] が ${blanks.length} 個`);
  else {
    const ans = blanks[0].slice(1, -1).toLowerCase();
    const base = w.word.toLowerCase();
    // 活用形として不自然に離れていないか（不規則変化は警告のみ）
    const stem = base.replace(/(e|y)$/, '');
    if (!ans.startsWith(stem.slice(0, Math.min(stem.length, 4))) && lev(ans, base) > 3)
      problems.push(`No.${w.no} ${w.word}: 空欄の語「${ans}」が見出し語と離れています（要確認）`);
  }
  if (!/【.+?】/.test(s.ja)) problems.push(`No.${w.no} ${w.word}: 和訳に【】がありません`);
  out.push({ no: w.no, word: w.word, meaning: w.meaning, en: s.en, ja: s.ja });
}
for (const n of sentences.keys()) if (!words.find((w) => w.no === n)) problems.push(`No.${n} はCSVにありません`);

fs.writeFileSync(OUT, '// 自動生成: node tools/build.js\nwindow.WORDS = ' + JSON.stringify(out).replace(/\},\{/g, '},\n{') + ';\n');
console.log(`単語 ${words.length} 語 / 例文あり ${out.length} 語 / 例文なし ${missing} 語`);
if (problems.length) { console.log(`\n要確認 ${problems.length} 件:`); problems.forEach((p) => console.log('  ' + p)); }

// ---- アイコンPNG（シンプルな図形のみ）----
function png(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.19;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0), dy = Math.max(r - y, y - (size - 1 - r), 0);
      const inside = dx * dx + dy * dy <= r * r;
      let c = [31, 78, 121, 255];
      const bar = y > size * 0.6 && y < size * 0.66 && x > size * 0.23 && x < size * 0.77;
      const blank = y > size * 0.3 && y < size * 0.5 && x > size * 0.3 && x < size * 0.7 && (y < size * 0.33 || y > size * 0.47 || x < size * 0.33 || x > size * 0.67);
      if (bar) c = [255, 216, 77, 255]; else if (blank) c = [255, 255, 255, 255];
      if (!inside) c = [0, 0, 0, 0];
      px.set(c, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) fs.writeFileSync(path.join(ROOT, 'app', `icon-${s}.png`), png(s));
