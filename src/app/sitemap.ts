import type { MetadataRoute } from 'next';
import { CURATED_VIDEOS } from '@/lib/curatedVideos';
import { siteUrl } from '@/lib/site';

/**
 * Seed sitemap.
 *
 * Lists the homepage and every curated transcript page. Long-tail
 * `/transcript/<id>` URLs are discovered through links and shares rather than
 * enumerated here — there is no bounded set of them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();

  return [
    { url: base, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...CURATED_VIDEOS.map((video) => ({
      url: `${base}/transcript/${video.id}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];
}
