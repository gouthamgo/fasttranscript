import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ExternalLink, Play } from 'lucide-react';

import { extractTranscript, extractYouTubeId } from '@/lib/youtubeExtractor';
import { AppError } from '@/lib/errors';
import { VideoMetadata } from '@/types';

/**
 * Server-rendered transcript pages — the acquisition surface.
 *
 * The incumbent in this market takes 56% of 6.4M monthly visits from organic
 * search. That is not winnable with a single client-rendered page, so every
 * extraction gets a crawlable URL here: real HTML, real transcript text, proper
 * canonical and OpenGraph tags, and VideoObject structured data.
 *
 * Rendered on demand and then cached, so a crawler sweeping thousands of URLs
 * costs one upstream fetch per video rather than one per request.
 */
export const revalidate = 86_400;
export const dynamicParams = true;

interface PageProps {
  params: { videoId: string };
}

/** Fetch once per render pass; Next dedupes this between metadata and body. */
async function loadTranscript(rawId: string): Promise<VideoMetadata | null> {
  const videoId = extractYouTubeId(rawId);
  if (!videoId) return null;
  try {
    return await extractTranscript(videoId);
  } catch (error) {
    // A missing video or a captionless one is a 404, not a server error.
    if (error instanceof AppError) return null;
    throw error;
  }
}

function summarise(video: VideoMetadata, limit = 155): string {
  const body = video.segments
    .slice(0, 6)
    .map((segment) => segment.text)
    .join(' ');
  return body.length > limit ? `${body.slice(0, limit - 1).trimEnd()}…` : body;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const video = await loadTranscript(params.videoId);
  if (!video) {
    return { title: 'Transcript not found — FastTranscript', robots: { index: false } };
  }

  const title = `${video.title} — Full Transcript`;
  const description = `Full timestamped transcript of “${video.title}” by ${video.channelTitle}. ${summarise(video, 90)}`;
  const canonical = `/transcript/${video.id}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      images: [{ url: video.thumbnailUrl, width: 480, height: 360, alt: video.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [video.thumbnailUrl],
    },
  };
}

export default async function TranscriptPage({ params }: PageProps) {
  const video = await loadTranscript(params.videoId);
  if (!video) notFound();

  // Structured data: this is what earns rich results for video queries.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: summarise(video, 300),
    thumbnailUrl: [video.thumbnailUrl],
    embedUrl: `https://www.youtube.com/embed/${video.id}`,
    contentUrl: video.url,
    duration: `PT${Math.floor(video.durationSeconds / 60)}M${video.durationSeconds % 60}S`,
    inLanguage: video.language ?? 'en',
    transcript: video.segments.map((segment) => segment.text).join(' '),
    publisher: { '@type': 'Organization', name: video.channelTitle },
  };

  return (
    <div className="min-h-screen bg-surface-light dark:bg-surface-dark text-zinc-950 dark:text-zinc-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white underline underline-offset-2">
            FastTranscript
          </Link>
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <span>Transcript</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight mb-3">
            {video.title}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {video.channelTitle} · {video.segments.length} timestamped segments · {video.durationFormatted} of
            captions
            {video.language ? ` · ${video.language.toUpperCase()}` : ''}
          </p>

          <div className="flex flex-wrap gap-3 mt-5">
            {/* The conversion path: reading the transcript is the hook, the
                interactive reader and the API are what we actually want. */}
            <Link
              href={`/?v=${video.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              Open interactive reader
            </Link>
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              Watch on YouTube
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>
        </header>

        <article className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
          {video.segments.map((segment) => (
            <p key={segment.id} className="flex gap-4 px-4 sm:px-6 py-3.5 text-sm sm:text-base leading-relaxed">
              <Link
                href={`/?v=${video.id}&t=${Math.floor(segment.start)}`}
                className="font-mono text-xs text-zinc-600 dark:text-zinc-400 pt-1 shrink-0 hover:text-zinc-900 dark:hover:text-white"
              >
                {segment.formattedTime}
              </Link>
              <span className="text-zinc-800 dark:text-zinc-200">{segment.text}</span>
            </p>
          ))}
        </article>

        <aside className="mt-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <h2 className="text-base font-bold mb-2">Need this in your own app?</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            One GET request returns this transcript as JSON, plain text, SRT or VTT. Free key, no signup, no card.
          </p>
          <pre className="text-xs font-mono bg-zinc-950 text-zinc-300 rounded-xl p-4 overflow-x-auto mb-4">
{`curl -X POST https://your-domain.com/api/v1/keys \\
  -H 'Content-Type: application/json' -d '{"name":"my app"}'`}
          </pre>
          <Link
            href="/?tab=api"
            className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            Read the API docs
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}
