/**
 * Canonical public origin.
 *
 * Sitemaps, canonical tags and OpenGraph URLs all need an absolute origin, and
 * getting it wrong silently costs indexing. Set NEXT_PUBLIC_SITE_URL in
 * production; Vercel's own variable is used as a fallback.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3001';
}
