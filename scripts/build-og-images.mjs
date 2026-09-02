/**
 * Social share images — DESIGN-SYSTEM.md §9.5.
 *
 * "the OG image is the painting `object-fit: contain` on a `--paper` canvas with a 1px `--line`
 * inner rule 48px in from the edge and the wordmark bottom-left in `--ink`. No cropping."
 *
 * One deviation, and §9.6 is the reason: §9.5 says "the wordmark bottom-left", but §9.6 lists the
 * three places the full seal appears as "here [the footer], on /about at 200px, and **on the OG
 * image**". So the seal goes bottom-left at 120px — §9.6's stated minimum — rather than a
 * typeset wordmark. It is her actual mark, it is what §9.6 asks for, and it needs no extra asset.
 *
 * `ogCrop` is honoured for the one case §9.5 allows: an artwork she explicitly opts into a
 * cover crop, using `focal`. Default is false, so everything is matted, never cropped.
 *
 * Run: npm run og:build   (also runs as part of npm run build)
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORK_DIR = join(root, 'src', 'content', 'artwork');
const SEAL = join(root, 'src', 'assets', 'seal.png');
const OUT_DIR = join(root, 'public', 'og');

const W = 1200;
const H = 630;
const PAPER = '#FCFBF7';
const LINE = '#D5DDD8';
const RULE_INSET = 48;
const SEAL_W = 120; // §9.6 minimum for the full seal
const PAD = 28; // breathing room inside the rule
const QUALITY = 80; // §9.3

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? (load(m[1]) ?? {}) : {};
}

/** Percent pair like "50% 40%" -> {x,y} in 0..1. Defaults to centre. */
function parseFocal(focal) {
  const m = String(focal ?? '').match(/(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  return m ? { x: +m[1] / 100, y: +m[2] / 100 } : { x: 0.5, y: 0.5 };
}

await mkdir(OUT_DIR, { recursive: true });

const seal = await sharp(SEAL)
  .resize({ width: SEAL_W, fit: 'inside' })
  .png()
  .toBuffer();
const sealMeta = await sharp(seal).metadata();

// The 1px inner rule, as a hairline SVG overlay.
const rule = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect x="${RULE_INSET + 0.5}" y="${RULE_INSET + 0.5}" ` +
    `width="${W - RULE_INSET * 2 - 1}" height="${H - RULE_INSET * 2 - 1}" ` +
    `fill="none" stroke="${LINE}" stroke-width="1"/></svg>`,
);

/**
 * Layout: the seal gets a reserved column on the left, the painting takes the rest of the
 * height inside the rule. Stacking the seal *below* the painting instead left only 326px of
 * height for the work in a 630px canvas, which made every portrait look like a thumbnail.
 * A reserved column gives the painting 478px and guarantees the seal can never overlap it,
 * whatever the aspect ratio.
 */
const sealLeft = RULE_INSET + PAD;
const sealTop = H - RULE_INSET - PAD - sealMeta.height;
const boxX = sealLeft + SEAL_W + PAD;
const boxY = RULE_INSET + PAD;
const boxW = W - RULE_INSET - PAD - boxX;
const boxH = H - (RULE_INSET + PAD) * 2;

let entries;
try {
  entries = (await readdir(ARTWORK_DIR)).filter((f) => f.endsWith('.md'));
} catch {
  console.log('og: no artwork entries, nothing to do');
  process.exit(0);
}

let built = 0;
let current = 0;
let cropped = 0;

for (const file of entries.sort()) {
  const slug = file.replace(/\.md$/, '');
  const entryPath = join(ARTWORK_DIR, file);
  const data = frontmatter(await readFile(entryPath, 'utf8'));
  if (!data.image) continue;

  const src = join(ARTWORK_DIR, data.image);
  const outPath = join(OUT_DIR, `${slug}.jpg`);

  let srcStat;
  try {
    srcStat = await stat(src);
  } catch {
    console.log(`og: WARNING cannot read ${data.image} for ${slug}`);
    continue;
  }
  const entryStat = await stat(entryPath);
  let outStat = null;
  try {
    outStat = await stat(outPath);
  } catch {}
  if (outStat && outStat.mtimeMs >= Math.max(srcStat.mtimeMs, entryStat.mtimeMs)) {
    current++;
    continue;
  }

  let painting;
  if (data.ogCrop) {
    // The one permitted crop (§9.5), and only when she opts in.
    const f = parseFocal(data.focal);
    painting = await sharp(src)
      .resize({
        width: boxW,
        height: boxH,
        fit: 'cover',
        position: `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%`,
      })
      .toBuffer();
    cropped++;
  } else {
    painting = await sharp(src)
      .resize({ width: boxW, height: boxH, fit: 'inside', withoutEnlargement: false })
      .toBuffer();
  }
  const pm = await sharp(painting).metadata();

  await sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .composite([
      // Centred in its box, so a portrait gets paper either side rather than being cropped.
      { input: painting, left: boxX + Math.round((boxW - pm.width) / 2), top: boxY + Math.round((boxH - pm.height) / 2) },
      { input: rule, left: 0, top: 0 },
      { input: seal, left: sealLeft, top: sealTop },
    ])
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(outPath);
  built++;
}

const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.jpg'));
let bytes = 0;
for (const f of files) bytes += (await stat(join(OUT_DIR, f))).size;

console.log(`og: ${built} built, ${current} already current, ${cropped} used ogCrop`);
console.log(`og: ${files.length} images, ${(bytes / 1024 / 1024).toFixed(1)} MB total, ${W}x${H} q${QUALITY}`);
