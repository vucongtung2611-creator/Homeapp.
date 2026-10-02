// Bundles the web app into dist/public and copies the self-hosted OCR engine.
import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'public');
const dev = process.argv.includes('--dev');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'web/src/main.tsx'), join(root, 'web/styles.css')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  outdir: join(out, 'assets'),
  entryNames: '[name]-[hash]',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  metafile: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
});

const outputs = Object.keys(result.metafile.outputs).map((p) => basename(p));
const js = outputs.find((f) => f.startsWith('main-') && f.endsWith('.js'));
const css = outputs.find((f) => f.startsWith('styles-') && f.endsWith('.css'));
writeFileSync(
  join(out, 'index.html'),
  readFileSync(join(root, 'web/index.html'), 'utf8').replace('__JS__', js).replace('__CSS__', css),
);
copyFileSync(join(root, 'web/manifest.webmanifest'), join(out, 'manifest.webmanifest'));

// OCR: tesseract.js + LSTM-only cores + compact Vietnamese/English models, all same-origin.
const ocr = join(out, 'ocr');
mkdirSync(join(ocr, 'core'), { recursive: true });
mkdirSync(join(ocr, 'lang'), { recursive: true });
copyFileSync(join(root, 'node_modules/tesseract.js/dist/tesseract.min.js'), join(ocr, 'tesseract.min.js'));
copyFileSync(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), join(ocr, 'worker.min.js'));
const coreDir = join(root, 'node_modules/tesseract.js-core');
for (const f of readdirSync(coreDir)) if (f.includes('lstm')) copyFileSync(join(coreDir, f), join(ocr, 'core', f));
for (const lang of ['eng', 'vie']) {
  copyFileSync(
    join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),
    join(ocr, 'lang', `${lang}.traineddata.gz`),
  );
}

// Icons: a white house on the brand colour, drawn without any image library.
const BRAND = [0x0e, 0x7c, 0x66];
function icon(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const r = maskable ? 0 : size * 0.22; // corner radius
  const s = maskable ? 0.62 : 0.74; // house scale
  const cx = size / 2;
  const top = size * (0.5 - s * 0.48);
  const roofBase = size * (0.5 - s * 0.06);
  const bottom = size * (0.5 + s * 0.42);
  const half = size * s * 0.46;
  const wall = size * s * 0.34;
  const door = size * s * 0.1;
  const inRounded = (x, y) => {
    const dx = Math.max(r - x, 0, x - (size - 1 - r));
    const dy = Math.max(r - y, 0, y - (size - 1 - r));
    return dx * dx + dy * dy <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x, y)) continue;
      let white = false;
      if (y >= top && y <= roofBase) white = Math.abs(x - cx) <= ((y - top) / (roofBase - top)) * half;
      if (y > roofBase && y <= bottom) white = Math.abs(x - cx) <= wall;
      if (y > bottom - (bottom - roofBase) * 0.55 && y <= bottom && Math.abs(x - cx) <= door) white = false;
      const [R, G, B] = white ? [255, 255, 255] : BRAND;
      px.set([R, G, B, 255], i);
    }
  }
  return png(size, size, px);
}
function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync(join(out, 'icon-192.png'), icon(192));
writeFileSync(join(out, 'icon-512.png'), icon(512));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, { maskable: true }));
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180, { maskable: true }));

console.log(`web: ${js}, ${css}`);
