/**
 * Content collections — brief.md §9, plus the additions DESIGN-SYSTEM.md §5.3 and §7.4 require.
 *
 * Astro v7 Content Layer API: this file is `src/content.config.ts`, collections take a `loader`,
 * entries are addressed by `id` (the filename), and markdown bodies render through
 * `render(entry)` imported from `astro:content`. The pre-v5 `src/content/config.ts` +
 * `entry.slug` + `entry.render()` shapes are gone.
 *
 * Two rules shaped almost every `.optional()` below:
 *   - hard rule 5 / brief §9: `frame`, `trim`, `altText`, `focal` and the whole `caseStudy`
 *     collection are load-bearing and must not be dropped.
 *   - "never invent content": `artwork-metadata.csv` currently has only file, folder, kind and
 *     title filled for all 55 works, plus real print prices on 6 of them. Everything else is
 *     genuinely unknown, so it is optional here and simply not rendered when absent — which is
 *     also what DESIGN-SYSTEM.md principle 4 asks for ("the empty state is always 'the element
 *     is not rendered'"). Fields Sunshine must eventually fill are marked `required: true` in
 *     public/admin/config.yml instead, so the CMS asks her without breaking today's build.
 */
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** A5–A1 only (brief §9). §6.3 holds the physical dimensions so she never types them. */
const printSize = z.enum(['A5', 'A4', 'A3', 'A2', 'A1']);

/** Prices are whole rupees. §6.4 formats them with Indian grouping at build. */
const rupees = z.number().int().nonnegative();

const artwork = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/artwork' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** Required: §7.1 — "An artwork without an image is not an artwork." */
      image: image(),
      year: z.number().int().optional(),
      medium: z.enum(['canvas', 'digital', 'sketch']).optional(),
      /** rev 2, §5.3/§6.1: free text like "acrylic on canvas", shown in the detail label line. */
      mediumDetail: z.string().optional(),
      category: z.enum(['portrait', 'landscape', 'pop', 'abstract', 'other']).optional(),
      /** §7.1 overflow: the CMS help text asks for `24 × 36 in` and nothing else. */
      dimensions: z.string().optional(),

      original: z
        .object({
          forSale: z.boolean().default(false),
          price: rupees.optional(),
          status: z.enum(['available', 'reserved', 'sold']).optional(),
        })
        .optional(),

      prints: z
        .object({
          available: z.boolean().default(false),
          /** Only the sizes she actually offers. §6.3 renders them A5 → A1 whatever the order. */
          sizes: z
            .array(z.object({ size: printSize, price: rupees.optional() }))
            .default([]),
        })
        .optional(),

      featured: z.boolean().default(false),
      order: z.number().int().optional(),

      /** §5.3 — 14 works carry a painted border inside the image file. */
      frame: z.enum(['none', 'dark', 'light']).default('none'),
      /** §5.3 — percent per edge, card derivatives ONLY. Defaults to 4% when `frame` is set;
       *  that default lives in the gallery helper, not here, so an explicit 0 stays 0. */
      trim: z
        .object({
          top: z.number().min(0).max(25).optional(),
          right: z.number().min(0).max(25).optional(),
          bottom: z.number().min(0).max(25).optional(),
          left: z.number().min(0).max(25).optional(),
        })
        .optional(),

      /** §10.3 — one sentence describing what is depicted. Required of her in the CMS. */
      altText: z.string().optional(),
      /** §9.5 — used ONLY for the OG crop, and only when ogCrop is set. */
      focal: z.string().optional(),
      ogCrop: z.boolean().default(false),
      /** rev 2, §9.2/§6.1 — a photograph of the work framed or in situ. Carries the photo hairline. */
      contextImage: image().optional(),
      /** §10.5 — only if she titles a work in Hindi or Kannada. */
      titleLang: z.string().default('en'),
    }),
});

const commissionType = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/commission-types' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      heroImage: image().optional(),
      examples: z.array(reference('artwork')).default([]),
      /** BLOCKED on Sunshine — brief §2: she has never published a commission price anywhere,
       *  and it cannot be inferred. Optional so the build runs; §13 omits the meta row when
       *  every part of it is missing. Never fill these in with a guess. */
      startingPrice: rupees.optional(),
      depositAmount: rupees.optional(),
      turnaround: z.string().optional(),
      whatsIncluded: z.array(z.string()).default([]),
      order: z.number().int().optional(),
    }),
});

/** §7.4 — the reference photo, her notes, the finished painting. Her strongest content. */
const caseStudy = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/case-studies' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      commissionType: reference('commissionType').optional(),
      /** Optional — §7.4 empty state: without it the block becomes a two-column 5/7. */
      referenceImage: image().optional(),
      /** Required — §7.4: "No finalImage → block not rendered, build error." */
      finalImage: image(),
      finalArtwork: reference('artwork').optional(),
      /** 1–6 short steps in her words. §7.4 renders the first 6 and warns beyond that. */
      notes: z.array(z.object({ text: z.string() })).default([]),
      quote: z.string().optional(),
      order: z.number().int().optional(),
    }),
});

const event = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      startDate: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      venue: z.string().optional(),
      city: z.string().optional(),
      image: image().optional(),
      link: z.string().url().optional(),
      /** §7.5: upcoming/past is DERIVED from endDate at build. This field is a manual override
       *  only, for something cancelled whose date has not yet passed. */
      status: z.enum(['upcoming', 'past']).optional(),
    }),
});

/**
 * Singleton. A one-entry glob collection rather than `file()`, because `file()` wants an array
 * of objects with ids or an id-keyed map, and this is one flat object. Sveltia edits the same
 * YAML through a `files` collection.
 */
const siteConfig = defineCollection({
  loader: glob({ pattern: '*.yml', base: './src/content/settings' }),
  schema: z.object({
    /** brief §8 — the phase-2 switch. Wired, always false in phase 1. */
    commerceEnabled: z.boolean().default(false),
    announcement: z
      .object({
        text: z.string().optional(),
        link: z.string().optional(),
        active: z.boolean().default(false),
      })
      .default({ active: false }),
    instagram: z.string().default('a_life_of_sunshine'),
    email: z.string().email().optional(),
    /** §13 /policies renders from this and MUST NOT guess. See BUILD-LOG: her Instagram bio
     *  says "ships worldwide" and her dm2buy shop policy says India only — unresolved. */
    shippingRegions: z.string(),
    processingTime: z.string().optional(),
    printPaper: z.string().optional(),
    policies: z
      .object({
        shipping: z.string().optional(),
        returns: z.string().optional(),
        damage: z.string().optional(),
      })
      .default({}),
    /** §13 + §14.3 — default `painting`. */
    hero: z
      .object({
        kind: z.enum(['painting', 'photo']).default('painting'),
        greeting: z.string().optional(),
        line: z.string().optional(),
        photo: z.string().optional(),
        focal: z.string().optional(),
      })
      .default({ kind: 'painting' }),
    /** §14.4 — default `label`: portfolio cards show the size/format label, not the title. */
    gallery: z
      .object({
        cardCaption: z.enum(['label', 'title', 'both']).default('label'),
      })
      .default({ cardCaption: 'label' }),
  }),
});

export const collections = { artwork, commissionType, caseStudy, event, siteConfig };
