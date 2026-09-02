/**
 * Web masters: the committed source images for the site.
 *
 * Reads every PNG in "images for website/orignal art/" and "images for website/custom art/"
 * and writes a 2400px-longest-edge JPEG q90 into src/assets/art/ with a kebab-case slug.
 * The multi-megabyte originals stay out of the repo (.gitignore); these are what Astro
 * takes as source and generates its AVIF/WebP derivatives from (DESIGN-SYSTEM.md §9.3).
 *
 * Spec this implements:
 *   CLAUDE.md step 1        — 2400px longest edge, JPEG q90, kebab-case, skip macOS ._* files
 *   DESIGN-SYSTEM.md §9.1   — convert to sRGB (45 of her 55 files are Display P3), no sharpening
 *   DESIGN-SYSTEM.md §5.2   — record the aspect ratio so the gallery can span landscapes
 *   DESIGN-SYSTEM.md §5.3   — flag images whose outer ring looks like a baked-in painted border
 *
 * Run: npm run art:masters   (add --force to re-encode files that are already up to date)
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { P3_TO_SRGB, colourPlan } from './lib/colour.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = [
  { dir: 'images for website/orignal art', origin: 'original' },
  { dir: 'images for website/custom art', origin: 'commission' },
];
const OUT_DIR = join(root, 'src', 'assets', 'art');

const LONGEST_EDGE = 2400;
const QUALITY = 90;
/** §9.1 / §2.3: JPEG has no alpha and sharp flattens onto black by default. These files are
 *  RGBA, so transparency must land on --paper — the colour it will sit on in the page. */
const PAPER = '#FCFBF7';
const force = process.argv.includes('--force');

/** Kebab-case slug from a filename: lowercase, separators to hyphens, punctuation dropped. */
function slugify(basename) {
  return basename
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/['’]/g, '')       // I'm_Stunnin_ -> im-stunnin
    .replace(/[^a-z0-9]+/g, '-')     // _ , space , comma , ( ) all become one hyphen
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * §5.3: detect a baked-in painted border, so step 4 knows which artworks need `frame`/`trim`.
 *
 * §5.3 specifies "outer 1.5% ring has luminance standard deviation < 12". Measured against
 * the 14 bordered works DESIGN-SYSTEM.md §0 names by title, that test does not separate them:
 * bordered files scored 42.8-109.4 and unbordered 33.8-91.3 — fully overlapping, 0 detections.
 * Her borders are *painted*, so they carry brush texture and are not flat enough for a
 * stddev threshold.
 *
 * This walks inward from each edge instead, counting lines that are both flat (sd < 14) and
 * close in mean to the outermost line, and reports the thinnest of the four edges as a
 * percentage. Measured on the same 55 files: 11 of the 14 named works detected at 3.8-6.4%,
 * and all 41 unbordered works at exactly 0.00 — no false positives. The three misses
 * (audrey-hepburn, ganga-in-light-of-chandrama, the-earth-is-your-mother) are the ones §0
 * itself describes as having a painted caption or a line running into the border, so their
 * edges genuinely are not flat.
 *
 * Still a warning, never an override: the editor sets `frame` (§5.3).
 */
const FLAT_LINE_STDDEV = 14;
const FLAT_LINE_MEAN_DRIFT = 14;
const BORDER_MIN_PERCENT = 2;

async function flatEdgePercent(buffer) {
  const img = sharp(buffer).greyscale();
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[y * width + x];

  const lineStats = (pts) => {
    const n = pts.length;
    const mean = pts.reduce((a, b) => a + b, 0) / n;
    const variance = pts.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return { mean, sd: Math.sqrt(variance) };
  };

  const maxScan = Math.floor(Math.min(width, height) * 0.15);
  const depths = [];
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    const span = edge === 'top' || edge === 'bottom' ? height : width;
    let ref = null;
    let depth = 0;
    for (let i = 0; i < maxScan; i++) {
      const pts = [];
      if (edge === 'top') for (let x = 0; x < width; x++) pts.push(at(x, i));
      else if (edge === 'bottom') for (let x = 0; x < width; x++) pts.push(at(x, height - 1 - i));
      else if (edge === 'left') for (let y = 0; y < height; y++) pts.push(at(i, y));
      else for (let y = 0; y < height; y++) pts.push(at(width - 1 - i, y));

      const s = lineStats(pts);
      if (ref === null) ref = s.mean;
      if (s.sd < FLAT_LINE_STDDEV && Math.abs(s.mean - ref) < FLAT_LINE_MEAN_DRIFT) depth = i + 1;
      else break;
    }
    depths.push((depth / span) * 100);
  }
  return Math.min(...depths);
}

await mkdir(OUT_DIR, { recursive: true });

const jobs = [];
for (const { dir, origin } of SOURCE_DIRS) {
  let entries;
  try {
    entries = await readdir(join(root, dir));
  } catch {
    console.error(`Source folder missing: ${dir}`);
    process.exit(1);
  }
  for (const name of entries.sort()) {
    // macOS AppleDouble sidecars are named ._Something.png — they are not images.
    if (name.startsWith('._') || name === '.DS_Store') continue;
    if (!name.toLowerCase().endsWith('.png')) continue;
    jobs.push({ src: join(root, dir, name), name, origin, dir });
  }
}

if (jobs.length === 0) {
  console.error('No source PNGs found.');
  process.exit(1);
}

const bySlug = new Map();
const manifest = [];
const warnings = [];
let converted = 0;
let skipped = 0;
let totalBytes = 0;

for (const job of jobs) {
  const base = job.name.replace(/\.png$/i, '');
  const slug = slugify(base);
  if (!slug) {
    warnings.push(`${job.name}: filename produces an empty slug — skipped`);
    continue;
  }
  if (bySlug.has(slug)) {
    warnings.push(
      `slug collision "${slug}": ${bySlug.get(slug)} and ${job.dir}/${job.name} — skipped the second`,
    );
    continue;
  }
  bySlug.set(slug, `${job.dir}/${job.name}`);

  const outPath = join(OUT_DIR, `${slug}.jpg`);
  const srcStat = await stat(job.src);

  let outStat = null;
  try {
    outStat = await stat(outPath);
  } catch {}
  const upToDate = outStat && outStat.mtimeMs >= srcStat.mtimeMs;

  const meta = await sharp(job.src).metadata();

  if (upToDate && !force) {
    const buf = await sharp(outPath).toBuffer();
    const m = await sharp(buf).metadata();
    manifest.push(await describe(job, slug, m, outStat.size, buf, colourPlan(meta.icc)));
    totalBytes += outStat.size;
    skipped++;
    continue;
  }

  const plan = colourPlan(meta.icc);
  if (plan.action === 'unknown') {
    // Do not guess at an unrecognised profile — converting with the wrong assumption is
    // worse than leaving it. Pass the pixels through untouched and say so.
    warnings.push(
      `${slug}: unrecognised colour profile "${plan.profile}" — passed through unconverted. ` +
        `Check how it looks before launch.`,
    );
  }
  const convertP3 = plan.action === 'p3-to-srgb';

  let pipeline = sharp(job.src, { ignoreIcc: convertP3 })
    .rotate() // honour EXIF orientation before resizing; a no-op for most PNGs
    .resize({
      width: LONGEST_EDGE,
      height: LONGEST_EDGE,
      fit: 'inside',
      withoutEnlargement: true, // several sources are already under 2400px — never upscale
    });

  if (convertP3) {
    // §9.1, done explicitly — see scripts/lib/colour.mjs for why sharp's own ICC calls
    // are not enough. Linear light, matrix, back to the sRGB transfer function.
    pipeline = pipeline
      .pipelineColourspace('scrgb')
      .recomb(P3_TO_SRGB)
      .toColourspace('srgb');
  }

  pipeline = pipeline
    // Flattened AFTER the colour conversion so --paper stays exactly #FCFBF7 rather than
    // being treated as a P3 value and shifted.
    .flatten({ background: PAPER })
    // Now the sRGB tag is true of the pixels, whichever branch produced them.
    .withIccProfile('srgb')
    .jpeg({ quality: QUALITY, chromaSubsampling: '4:2:0', mozjpeg: true });
  // No .sharpen() anywhere — §9.1: her impasto textures alias badly when sharpened.

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  await writeFile(outPath, data);

  manifest.push(await describe(job, slug, info, data.length, data, plan));
  totalBytes += data.length;
  converted++;
}

async function describe(job, slug, info, bytes, buffer, plan) {
  const width = info.width;
  const height = info.height;
  const ratio = width / height;
  const edgePercent = await flatEdgePercent(buffer);
  const likelyBorder = edgePercent >= BORDER_MIN_PERCENT;
  if (likelyBorder) {
    warnings.push(
      `${slug}: flat edge ${edgePercent.toFixed(1)}% deep on its thinnest side — likely a ` +
        `baked-in painted border. Set frame: dark|light (and trim if 4% is wrong) at step 4 (§5.3).`,
    );
  }
  return {
    slug,
    origin: job.origin,
    source: `${job.dir}/${job.name}`,
    width,
    height,
    ratio: Number(ratio.toFixed(4)),
    // §5.2: > 1.15 spans two gallery columns. Recorded, not decided, here.
    landscape: ratio > 1.15,
    bytes,
    flatEdgePercent: Number(edgePercent.toFixed(2)),
    likelyBakedBorder: likelyBorder,
    sourceProfile: plan.profile,
    colourAction: plan.action,
  };
}

manifest.sort((a, b) => a.slug.localeCompare(b.slug));
await writeFile(
  join(OUT_DIR, 'manifest.json'),
  JSON.stringify(
    {
      generatedBy: 'scripts/build-web-masters.mjs',
      longestEdge: LONGEST_EDGE,
      quality: QUALITY,
      note: 'Derived file. Regenerate with `npm run art:masters`. Aspect ratios here are for reference; the gallery measures them from the imported asset at build time (§5.2).',
      count: manifest.length,
      images: manifest,
    },
    null,
    2,
  ) + '\n',
);

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const landscapes = manifest.filter((m) => m.landscape);
const borders = manifest.filter((m) => m.likelyBakedBorder);

console.log('');
for (const m of manifest) {
  console.log(
    `${m.slug.padEnd(42)} ${String(m.width).padStart(4)}x${String(m.height).padEnd(4)} ` +
      `${(m.bytes / 1024).toFixed(0).padStart(5)} KB  ${m.landscape ? 'landscape' : '         '} ` +
      `${m.likelyBakedBorder ? 'border?' : ''}`,
  );
}

console.log('');
console.log(`converted:        ${converted}`);
console.log(`already current:  ${skipped}`);
console.log(`total images:     ${manifest.length}`);
console.log(`total size:       ${mb(totalBytes)} MB`);
console.log(`landscapes (>1.15): ${landscapes.length}`);
console.log(`likely baked borders: ${borders.length}  ${borders.map((b) => b.slug).join(', ')}`);

if (warnings.length) {
  console.log('');
  console.log('WARNINGS');
  for (const w of warnings) console.log(`  - ${w}`);
}
