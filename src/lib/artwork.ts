/**
 * Shared artwork logic. Everything here is a rule from DESIGN-SYSTEM.md rather than a choice,
 * so the gallery, the detail page and the home page cannot drift apart.
 */
import type { CollectionEntry } from 'astro:content';

export type Artwork = CollectionEntry<'artwork'>;

/** §6.3 — A-series sizes, always smallest first regardless of entry order. */
export const PRINT_SIZE_ORDER = ['A5', 'A4', 'A3', 'A2', 'A1'] as const;
export type PrintSize = (typeof PRINT_SIZE_ORDER)[number];

/** §6.3 — fixed physical dimensions, so she never types them. */
export const PRINT_DIMENSIONS: Record<PrintSize, { cm: string; in: string }> = {
  A5: { cm: '14.8 × 21', in: '5.8 × 8.3' },
  A4: { cm: '21 × 29.7', in: '8.3 × 11.7' },
  A3: { cm: '29.7 × 42', in: '11.7 × 16.5' },
  A2: { cm: '42 × 59.4', in: '16.5 × 23.4' },
  A1: { cm: '59.4 × 84.1', in: '23.4 × 33.1' },
};

/** §5.2 — a cell wider than this spans two gallery columns. Measured from the file, never input. */
export const LANDSCAPE_RATIO = 1.15;

export function isLandscape(art: Artwork): boolean {
  return art.data.image.width / art.data.image.height > LANDSCAPE_RATIO;
}

/**
 * §6.4 — Indian grouping, no paise: ₹1,700 · ₹27,000 · ₹1,20,000.
 */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatPrice(value: number | undefined): string | null {
  return typeof value === 'number' ? inr.format(value) : null;
}

/** Print sizes she actually offers, ordered A5 → A1 (§6.3). */
export function orderedSizes(art: Artwork) {
  const sizes = art.data.prints?.sizes ?? [];
  return [...sizes].sort(
    (a, b) => PRINT_SIZE_ORDER.indexOf(a.size) - PRINT_SIZE_ORDER.indexOf(b.size),
  );
}

export function hasPrints(art: Artwork): boolean {
  return Boolean(art.data.prints?.available) && orderedSizes(art).length > 0;
}

/** `PRINTS A5–A1`, or `PRINTS A4` when only one size is offered (§5.4). */
function printRange(art: Artwork): string | null {
  const sizes = orderedSizes(art);
  if (sizes.length === 0) return null;
  const first = sizes[0].size;
  const last = sizes[sizes.length - 1].size;
  return first === last ? `PRINTS ${first}` : `PRINTS ${first}–${last}`;
}

/**
 * §5.4 — dimensions normalised to `W × H UNIT`: multiplication sign, not the letter x, and her
 * unit kept as she typed it.
 */
export function normaliseDimensions(dimensions: string | undefined): string | null {
  if (!dimensions) return null;
  return dimensions.replace(/\s*[x×X]\s*/, ' × ').replace(/\s+/g, ' ').trim();
}

/**
 * §5.4 — the one card label, decided at build in this priority order:
 *   canvas + dimensions   -> `24 × 36 IN · CANVAS`
 *   canvas, no dimensions -> `CANVAS ORIGINAL`
 *   digital + prints      -> `PRINTS A5–A1`
 *   digital, no prints    -> `DIGITAL`
 *   sketch                -> `SKETCH`
 * then ` · SOLD` / ` · RESERVED` appended if the original is gone.
 *
 * `medium` is optional in practice — the CSV has it blank for all 55 works — and §5.4's list is
 * keyed on it, so the fallbacks below use whatever facts do exist. Returning null means the
 * label is not rendered at all, which is principle 4's empty state.
 */
export function cardLabel(art: Artwork): string | null {
  const { medium, dimensions } = art.data;
  const dims = normaliseDimensions(dimensions);
  let base: string | null = null;

  if (medium === 'canvas') {
    base = dims ? `${dims} · CANVAS` : 'CANVAS ORIGINAL';
  } else if (medium === 'digital') {
    base = hasPrints(art) ? printRange(art) : 'DIGITAL';
  } else if (medium === 'sketch') {
    base = 'SKETCH';
  } else {
    // No medium recorded yet. Prefer a real fact over a guess about the medium.
    base = dims ?? printRange(art);
  }

  if (!base) return null;

  const status = art.data.original?.status;
  if (status === 'sold') return `${base} · SOLD`;
  if (status === 'reserved') return `${base} · RESERVED`;
  return base;
}

/** §6.1 item 4 — the detail label line: size, then medium, then year; each part omitted if absent. */
export function detailLabel(art: Artwork): string | null {
  const { dimensions, mediumDetail, medium, year } = art.data;
  const parts = [
    normaliseDimensions(dimensions),
    mediumDetail ?? (medium ? medium.toUpperCase() : null),
    hasPrints(art) && !dimensions ? printRange(art) : null,
    year ? String(year) : null,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * §10.3 — alt text rules. `altText` is what she writes; these are the fallbacks when it is
 * missing, which is every artwork today.
 */
export function cardAlt(art: Artwork): string {
  if (art.data.altText) return art.data.altText;
  const label = cardLabel(art);
  return label ? `${art.data.title}, ${label.toLowerCase()}` : art.data.title;
}

export function detailAlt(art: Artwork): string {
  if (art.data.altText) return `${art.data.title} — ${art.data.altText}`;
  const medium = art.data.medium ? `${art.data.medium} ` : '';
  return `${art.data.title}, ${medium}by Sunshine Kiara Bhandary`;
}

/** True when §10.3 says the build should warn about missing alt text. */
export function missingAltText(art: Artwork): boolean {
  return !art.data.altText;
}

/**
 * §5.7 — sort by `order` ascending, then `year` descending, then title. Entries without an
 * `order` sort after those that have one, so a partly-curated list still behaves.
 */
export function sortArtworks(list: Artwork[]): Artwork[] {
  return [...list].sort((a, b) => {
    const ao = a.data.order ?? Number.POSITIVE_INFINITY;
    const bo = b.data.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    const ay = a.data.year ?? 0;
    const by = b.data.year ?? 0;
    if (ay !== by) return by - ay;
    return a.data.title.localeCompare(b.data.title);
  });
}

/**
 * Card images for the 14 works with a painted border (§5.3). Built by
 * scripts/build-card-derivatives.mjs; looked up by slug because the set is only known at build.
 * The detail page never uses these — it always shows the untrimmed file.
 */
const cardDerivatives = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/art/cards/*.jpg',
  { eager: true },
);

export function cardImage(art: Artwork): ImageMetadata {
  if (art.data.frame && art.data.frame !== 'none') {
    const hit = cardDerivatives[`/src/assets/art/cards/${art.id}.jpg`];
    if (hit) return hit.default;
  }
  return art.data.image;
}
