/**
 * Copies the self-hosted woff2 faces out of the installed @fontsource-variable
 * packages into public/fonts/. Run after upgrading either package.
 *
 * Which files, and why those: DESIGN-SYSTEM.md §3.1 and the comment block at the
 * top of src/styles/fonts.css.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'fonts');

const FACES = [
  {
    from: '@fontsource-variable/bodoni-moda/files/bodoni-moda-latin-standard-normal.woff2',
    to: 'bodoni-moda-latin.woff2',
    note: 'wght 400-900 + opsz 6-96, latin',
  },
  {
    from: '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
    to: 'dm-sans-latin.woff2',
    note: 'wght 100-1000, latin',
  },
  {
    from: '@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2',
    to: 'dm-sans-latin-ext.woff2',
    note: 'wght 100-1000, latin-ext (carries the rupee sign)',
  },
];

const BUDGET_BYTES = 90 * 1024; // §3.1
const PRELOADED = new Set(['bodoni-moda-latin.woff2', 'dm-sans-latin.woff2']);

await mkdir(dest, { recursive: true });

let preloadedBytes = 0;
for (const face of FACES) {
  const src = join(root, 'node_modules', face.from);
  const out = join(dest, face.to);
  await copyFile(src, out);
  const { size } = await stat(out);
  if (PRELOADED.has(face.to)) preloadedBytes += size;
  console.log(`${face.to.padEnd(26)} ${(size / 1024).toFixed(1).padStart(6)} KB  ${face.note}`);
}

const kb = (preloadedBytes / 1024).toFixed(1);
if (preloadedBytes > BUDGET_BYTES) {
  console.error(`\nPreloaded faces total ${kb} KB, over the 90 KB budget in §3.1.`);
  process.exit(1);
}
console.log(`\nPreloaded faces total ${kb} KB — within the 90 KB budget (§3.1).`);
