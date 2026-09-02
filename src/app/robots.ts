import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Transcript pages are the indexable surface; the API and the
      // query-parameter app view are not.
      disallow: ['/api/'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
