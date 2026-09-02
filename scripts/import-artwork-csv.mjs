/**
 * Creates artwork content entries from artwork-metadata.csv.
 *
 * Sunshine fills the CSV in; re-running this picks up what she has added. By default it only
 * creates entries that do not exist yet, so nothing she or Claude has since edited through the
 * CMS gets clobbered. `--force` rewrites everything from the CSV.
 *
 * The rule this script exists to keep: **a blank cell becomes an absent field, never a guess.**
 * Today the CSV has file/folder/kind/title on all 55 rows and print prices on 6. Everything else
 * is blank, so almost every entry here is just a title and an image, and the pages render the
 * fields that exist and omit the rest (DESIGN-SYSTEM.md principle 4).
 *
 * Run: node scripts/import-artwork-csv.mjs [--force]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(root, 'artwork-metadata.csv');
const OUT_DIR = join(root, 'src', 'content', 'artwork');
const MANIFEST = join(root, 'src', 'assets', 'art', 'manifest.json');

const force = process.argv.includes('--force');

/**
 * The 14 works with a painted border, named and classified in DESIGN-SYSTEM.md §0. This is
 * review data from someone who looked at all 55 files, not my inference — the CSV's own
 * "border baked into image?" column is blank for every row. §5.3 keeps the final say with the
 * editor; this only sets the starting value so the gallery does not read as a jumble on day one.
 */
const FRAMED = {
  dark: [
    'audrey-hepburn',
    'ganga-in-light-of-chandrama',
    'diwali-with-the-stars',
    'haunted',
    'monica-belluci',
    'nandi',
    'queen-diana',
    'the-earth-is-your-mother',
    'this-summer-is-going-to-be-different',
    'we-turn-to-flowers',
  ],
  light: ['a-boy-and-a-cat', 'a-life-of-sunshine', 'barbs', 'she-is-what-she-dreams'],
};

/** Minimal RFC 4180 parse — one filename contains a comma, so splitting on ',' is wrong. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      /* ignore */
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ''));
}

/** Same slug rule as build-web-masters.mjs, so entry ids line up with the image filenames. */
function slugify(basename) {
  return basename
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const clean = (v) => (v ?? '').trim();
const yes = (v) => /^(y|yes|true)$/i.test(clean(v));
const int = (v) => {
  const n = Number(clean(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && clean(v) !== '' ? n : undefined;
};

/** YAML for the frontmatter. Only ever emits keys that have a value. */
function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((v) => `${pad}- ${toYaml(v, indent + 1).trimStart()}`).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => {
        if (v === undefined) return null;
        if (Array.isArray(v)) return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        if (v && typeof v === 'object') return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        return `${pad}${k}: ${scalar(v)}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return `${pad}${scalar(value)}`;
}

function scalar(v) {
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  // Quote anything YAML might misread; her titles contain commas, colons and apostrophes.
  return /^[\w][\w .()&'’-]*$/.test(s) && !/: /.test(s) ? s : JSON.stringify(s);
}

const csv = parseCsv((await readFile(CSV, 'utf8')).replace(/^﻿/, ''));
const head = csv[0];
const rows = csv.slice(1);
const col = (name) => head.findIndex((h) => h.toLowerCase().startsWith(name.toLowerCase()));

const iFile = col('file');
const iTitle = col('title');
const iMedium = col('medium');
const iCategory = col('category');
const iYear = col('year');
const iDims = col('dimensions');
const iStory = col('story');
const iForSale = col('original for sale');
const iPrice = col('original price');
const iStatus = col('original status');
const iPrintsAvail = col('prints available');
const iAlt = col('alt text');
const iBorder = col('border baked');
const iHome = col('show on homepage');
const printCols = { A5: col('print A5'), A4: col('print A4'), A3: col('print A3'), A2: col('print A2'), A1: col('print A1') };

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const measured = new Map(manifest.images.map((i) => [i.slug, i]));

const existing = new Set(
  (await readdir(OUT_DIR)).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
);

let written = 0;
let skipped = 0;
const notes = [];
const blanks = new Map();

for (const row of rows) {
  const slug = slugify(clean(row[iFile]).replace(/\.png$/i, ''));
  if (!slug) continue;

  if (existing.has(slug) && !force) {
    skipped++;
    continue;
  }
  if (!measured.has(slug)) {
    notes.push(`${slug}: no web master — run \`npm run art:masters\` first. Skipped.`);
    continue;
  }

  const data = { title: clean(row[iTitle]) || slug.replace(/-/g, ' ') };
  if (!clean(row[iTitle])) notes.push(`${slug}: no title in the CSV, used the slug`);
  data.image = `../../assets/art/${slug}.jpg`;

  const medium = clean(row[iMedium]).toLowerCase();
  if (['canvas', 'digital', 'sketch'].includes(medium)) data.medium = medium;

  const category = clean(row[iCategory]).toLowerCase();
  if (['portrait', 'landscape', 'pop', 'abstract', 'other'].includes(category)) data.category = category;

  const year = int(row[iYear]);
  if (year) data.year = year;

  if (clean(row[iDims])) data.dimensions = clean(row[iDims]);
  if (clean(row[iAlt])) data.altText = clean(row[iAlt]);

  // The original. Only emitted if she has said something about it.
  const status = clean(row[iStatus]).toLowerCase();
  const price = int(row[iPrice]);
  const forSale = yes(row[iForSale]);
  if (forSale || price !== undefined || ['available', 'reserved', 'sold'].includes(status)) {
    data.original = {
      forSale,
      price,
      status: ['available', 'reserved', 'sold'].includes(status) ? status : undefined,
    };
  }

  // Prints. Only the sizes that carry a price — no interpolating between A5 and A1.
  const sizes = [];
  for (const [size, idx] of Object.entries(printCols)) {
    if (idx < 0) continue;
    const p = int(row[idx]);
    if (p !== undefined) sizes.push({ size, price: p });
  }
  if (yes(row[iPrintsAvail]) || sizes.length) {
    data.prints = { available: yes(row[iPrintsAvail]), sizes };
    const missing = Object.keys(printCols).filter(
      (s) => !sizes.some((x) => x.size === s),
    );
    if (yes(row[iPrintsAvail]) && missing.length) {
      blanks.set(slug, `prints on but no price for ${missing.join('/')}`);
    }
  }

  if (yes(row[iHome])) data.featured = true;

  // frame: her CSV column first, then §0's reviewed list, then none.
  const csvBorder = clean(row[iBorder]).toLowerCase();
  let frame = 'none';
  if (['none', 'dark', 'light'].includes(csvBorder)) frame = csvBorder;
  else if (FRAMED.dark.includes(slug)) frame = 'dark';
  else if (FRAMED.light.includes(slug)) frame = 'light';
  data.frame = frame;

  // §5.3 gives `trim` to the editor and defaults to 4%. Where the masters script actually
  // measured a flat edge deeper than that, seed it so the default does not leave a visible
  // strip of border on the card. Rounded up to the nearest whole percent. Measurement, not taste.
  if (frame !== 'none') {
    const depth = measured.get(slug)?.flatEdgePercent ?? 0;
    if (depth > 4) {
      const t = Math.ceil(depth);
      data.trim = { top: t, right: t, bottom: t, left: t };
    }
  }

  const story = clean(row[iStory]);
  const body = story ? `\n${story}\n` : '';

  const header =
    frame !== 'none' && data.trim
      ? `# frame/trim: §0 lists this work as having a ${frame} painted border; the masters script\n` +
        `# measured its flat edge at ${measured.get(slug).flatEdgePercent}%. Thumbnails only (§5.3).\n`
      : '';

  await writeFile(
    join(OUT_DIR, `${slug}.md`),
    `---\n${header}${toYaml(data)}\n---\n${body}`,
    'utf8',
  );
  written++;
}

console.log(`entries written:  ${written}`);
console.log(`left alone:       ${skipped}${force ? '' : '  (already existed; use --force to rewrite)'}`);

// What is still missing, so it lands in the build log rather than being quietly forgotten.
const all = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.md'));
const counts = { medium: 0, category: 0, year: 0, dimensions: 0, story: 0, altText: 0, original: 0, prints: 0 };
for (const f of all) {
  const t = await readFile(join(OUT_DIR, f), 'utf8');
  const fm = t.slice(0, t.indexOf('\n---', 4));
  for (const k of Object.keys(counts)) if (new RegExp(`^${k}:`, 'm').test(fm)) counts[k]++;
  if (/^---\n[\s\S]*?\n---\n\s*\S/.test(t)) counts.story++;
}
console.log('');
console.log(`total entries:    ${all.length}`);
console.log('fields present across all entries (the rest are blank in the CSV):');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}/${all.length}`);
if (blanks.size) {
  console.log('');
  console.log('partial print pricing (deliberately not interpolated):');
  for (const [s, m] of blanks) console.log(`  ${s.padEnd(38)} ${m}`);
}
for (const n of notes) console.log(`NOTE ${n}`);
