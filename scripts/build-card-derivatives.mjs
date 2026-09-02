/**
 * Card derivatives for artworks with a painted border baked into the file.
 *
 * DESIGN-SYSTEM.md §5.3: "When `frame` is `dark` or `light`, the image pipeline produces a card
 * derivative cropped inward by `trim` (default 4% on each edge). Gallery cards use the card
 * derivative. The detail page always shows the untrimmed file."
 *
 * Why this is a build step and not CSS or an Astro transform:
 *   - §5.3 ends with "Nothing in CSS attempts to detect or hide borders", so clipping in CSS is
 *     out even though it would be a one-liner.
 *   - Astro's image service takes width/height/fit/position/quality/format. None of those can
 *     express "inset each edge by n%", so `getImage()` cannot do it either.
 * So the crop happens here, and the gallery picks the derivative up by slug.
 *
 * `trim` is editor data, not file data, which is why this reads the content entries rather than
 * living in build-web-masters.mjs. Change `frame`/`trim` in the CMS and the next build re-crops.
 *
 * Runs as part of `npm run build`, before `astro build`.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORK_DIR = join(root, 'src', 'content', 'artwork');
const OUT_DIR = join(root, 'src', 'assets', 'art', 'cards');

/** §5.3 — "defaults to 4% if frame set and trim is absent". */
const DEFAULT_TRIM = 4;
const QUALITY = 90;

/** Frontmatter only; the body is the story and is not needed here. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? (load(m[1]) ?? {}) : {};
}

await mkdir(OUT_DIR, { recursive: true });

let entries;
try {
  entries = (await readdir(ARTWORK_DIR)).filter((f) => f.endsWith('.md'));
} catch {
  console.log('cards: no artwork entries yet, nothing to do');
  process.exit(0);
}

let built = 0;
let current = 0;
const warnings = [];

for (const file of entries.sort()) {
  const slug = file.replace(/\.md$/, '');
  const data = frontmatter(await readFile(join(ARTWORK_DIR, file), 'utf8'));

  if (!data.frame || data.frame === 'none') continue;
  if (!data.image) {
    warnings.push(`${slug}: frame is "${data.frame}" but there is no image`);
    continue;
  }

  // `image` is written relative to the entry file (../../assets/art/x.jpg) so that Astro's
  // image() can resolve it. Resolve it the same way here.
  const src = join(ARTWORK_DIR, data.image);
  let meta;
  try {
    meta = await sharp(src).metadata();
  } catch {
    warnings.push(`${slug}: cannot read ${data.image}`);
    continue;
  }

  const t = data.trim ?? {};
  const pct = {
    top: t.top ?? DEFAULT_TRIM,
    right: t.right ?? DEFAULT_TRIM,
    bottom: t.bottom ?? DEFAULT_TRIM,
    left: t.left ?? DEFAULT_TRIM,
  };

  const left = Math.round((meta.width * pct.left) / 100);
  const top = Math.round((meta.height * pct.top) / 100);
  const width = meta.width - left - Math.round((meta.width * pct.right) / 100);
  const height = meta.height - top - Math.round((meta.height * pct.bottom) / 100);

  if (width <= 0 || height <= 0) {
    warnings.push(`${slug}: trim of ${JSON.stringify(pct)} would remove the whole image — skipped`);
    continue;
  }

  const outPath = join(OUT_DIR, `${slug}.jpg`);
  const [srcStat, entryStat] = await Promise.all([stat(src), stat(join(ARTWORK_DIR, file))]);
  let outStat = null;
  try {
    outStat = await stat(outPath);
  } catch {}
  // Rebuild when either the master or the entry (where trim lives) is newer.
  if (outStat && outStat.mtimeMs >= Math.max(srcStat.mtimeMs, entryStat.mtimeMs)) {
    current++;
    continue;
  }

  const buf = await sharp(src)
    .extract({ left, top, width, height })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();
  await writeFile(outPath, buf);
  console.log(
    `cards: ${slug.padEnd(40)} ${meta.width}x${meta.height} -> ${width}x${height}  ` +
      `(${pct.top}/${pct.right}/${pct.bottom}/${pct.left}%)`,
  );
  built++;
}

console.log(`cards: ${built} built, ${current} already current`);
for (const w of warnings) console.log(`cards: WARNING ${w}`);
