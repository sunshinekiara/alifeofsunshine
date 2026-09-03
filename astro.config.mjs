// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  /**
   * Needed for absolute URLs in canonical links, Open Graph tags and the sitemap.
   * Live on her own domain since 2026-09-03. DNS at GoDaddy (A @ -> 75.2.60.5,
   * CNAME www -> funny-nougat-cdd057.netlify.app); Netlify serves the apex as primary and
   * redirects www to it, with an automatic Let's Encrypt certificate.
   */
  site: 'https://alifeofsunshine.com',
});
