/**
 * Brand assets derived from her seal — DESIGN-SYSTEM.md §7.9, §9.6, §13.
 *
 * Source: brand/logo-seal-crop.png, her seal from the art book. `brand/` is gitignored as an
 * internal folder, so these committed derivatives are how the seal reaches the site. Only
 * derivatives are committed; the source stays local.
 *
 * The crop has her sage field baked in, measured at rgb(122,181,144) — which is `--sage`
 * #7BB58F to within one unit per channel. So:
 *   - the transparent version (background keyed out by colour distance) is used wherever the
 *     seal sits on a surface: `--sage` in the footer, `--paper` on /about and the OG image.
 *   - the icons keep her sage field, because a transparent favicon inverts badly on a dark
 *     browser tab.
 *
 * §9.6 wants the seal as traced SVG with currentColor strokes, and says Sunshine approves the
 * trace before it ships. That trace does not exist yet, so this ships her actual artwork as a
 * raster instead: it cannot recolour with currentColor, but it is unmistakably hers rather than
 * my redraw. Swap in the SVG when the trace is approved.
 *
 * Run: npm run brand:build
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The vector page, not the raster crop: brand/logo-page40.svg is page 40 of her book with the
// lettering already outlined, so the seal can be rendered crisp at any size. The raster crop
// (logo-seal-crop.png) is only 1344px wide and softens at the 200px /about size on 2x screens.
const SRC_SVG = join(root, 'brand', 'logo-page40.svg');
const RENDER_WIDTH = 2400;
const ASSETS = join(root, 'src', 'assets');
const PUBLIC = join(root, 'public');

/** How far a pixel must be from the flat background before it counts as line art. */
const KEY_TOLERANCE = 70;

await mkdir(ASSETS, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

// Render the vector page large, then trim the flat sage margin down to the artwork itself.
// limitInputPixels is lifted because the page embeds a large bitmap (CLAUDE.md: "page 40 as
// vector — text is outlined, seal is raster inside"), which the density multiplies up.
const page = await sharp(SRC_SVG, { density: 300, limitInputPixels: false, unlimited: true })
  .resize({ width: RENDER_WIDTH, fit: 'inside' })
  .png()
  .toBuffer();
const cropped = await sharp(page)
  .trim({ threshold: 12 })
  .png()
  .toBuffer();

const { data, info } = await sharp(cropped).raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const bg = [data[0], data[1], data[2]];

// Alpha from distance to the flat background colour. Works cleanly here because the field is
// genuinely flat, so anti-aliased strokes get partial alpha rather than a halo.
const rgba = Buffer.alloc(W * H * 4);
for (let i = 0, j = 0; i < W * H; i++, j += C) {
  const r = data[j];
  const g = data[j + 1];
  const b = data[j + 2];
  const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
  rgba[i * 4] = r;
  rgba[i * 4 + 1] = g;
  rgba[i * 4 + 2] = b;
  rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((d / KEY_TOLERANCE) * 255)));
}

const keyed = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toBuffer();

// The seal on transparency, for the footer (160px), /about (200px) and the OG image.
// 800px source so it stays crisp at 2x on the largest use.
const sealPath = join(ASSETS, 'seal.png');
await sharp(keyed).resize({ width: 800, fit: 'inside' }).png({ compressionLevel: 9 }).toFile(sealPath);

// Icons keep her sage field.
const icons = [
  { file: 'favicon-16.png', size: 16 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-512.png', size: 512 },
];
for (const { file, size } of icons) {
  await sharp(cropped)
    .resize({ width: size, height: size, fit: 'contain', background: '#7BB58F' })
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, file));
}

const stats = [];
for (const { file } of icons) {
  const m = await sharp(join(PUBLIC, file)).metadata();
  stats.push(`${file.padEnd(22)} ${m.width}x${m.height}`);
}
const sealMeta = await sharp(sealPath).metadata();

console.log(`source           ${W}x${H}  background rgb(${bg.join(',')})`);
console.log(`seal.png         ${sealMeta.width}x${sealMeta.height}  transparent`);
for (const s of stats) console.log(s);
