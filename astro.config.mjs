// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  /**
   * Needed for absolute URLs in canonical links, Open Graph tags and the sitemap.
   * This is the temporary Netlify subdomain — CHANGE IT when the site is renamed to
   * `alifeofsunshine` and again when the real domain is wired (both are Rachit's to do,
   * BUILD-STEPS.md step 8). Until then every og:url and canonical points here.
   */
  site: 'https://funny-nougat-cdd057.netlify.app',
});
