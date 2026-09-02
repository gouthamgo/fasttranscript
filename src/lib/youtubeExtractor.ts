import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptResponse,
} from 'youtube-transcript';

import { VideoMetadata, TranscriptSegment } from '../types';
import { getCached, setCached, setCachedFailure, hasCached } from './cache';
import { AppError } from './errors';
import { fetchWithTimeout, boundFetch, BROWSER_HEADERS, SingleFlight } from './http';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];

/**
 * Resolve a YouTube video ID from a URL or bare ID.
 *
 * Parses with the URL API and checks the host explicitly, rather than pattern
 * matching a substring. The old regex accepted `evil.com/youtube.com/watch?v=…`
 * and, worse, silently truncated an over-long `v` param to a different but
 * perfectly valid video ID — returning someone else's transcript for a
 * malformed request. Both are rejected here.
 */
export function extractYouTubeId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  if (VIDEO_ID.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const isYouTube = YOUTUBE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!isYouTube) return null;

  // Exact-length match only: a 12-character `v` is an error, not an 11-character ID.
  const valid = (candidate: string | null | undefined): string | null =>
    candidate && VIDEO_ID.test(candidate) ? candidate : null;

  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host.endsWith('.youtu.be')) return valid(segments[0]);
  if (segments[0] === 'watch') return valid(url.searchParams.get('v'));
  // /shorts/, /embed/, /live/ and the legacy /v/ all carry the ID in the path.
  if (['shorts', 'embed', 'live', 'v', 'e'].includes(segments[0] ?? '')) return valid(segments[1]);

  return valid(url.searchParams.get('v'));
}

/** HH:MM:SS when the video runs an hour or more, otherwise MM:SS. */
export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Always HH:MM:SS,mmm — the form SRT requires regardless of video length. */
export function formatTimecode(totalSeconds: number, separator: ',' | '.' = ','): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
};

/**
 * Decode HTML entities in a single pass.
 *
 * One pass is the correct semantics: `&amp;amp;` must become `&amp;`, not `&`.
 * The previous code applied a second round of replacements on text the library
 * had already decoded, which collapsed literal escaped ampersands.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Decide whether the library handed us milliseconds or seconds.
 *
 * youtube-transcript returns milliseconds from YouTube's srv3 caption format but
 * SECONDS from its classic-format fallback, and it does not tell you which. An
 * unconditional `/1000` therefore renders every timestamp as 00:00 whenever
 * YouTube happens to serve the classic format — silently, with a 200 response.
 *
 * A caption cue lasts on the order of 1-10 seconds. Expressed in milliseconds
 * that is 1000-10000. The median cue duration separates the two unambiguously:
 * no real cue lasts 100+ seconds, and none lasts under 100 milliseconds.
 */
function detectTimeScale(items: TranscriptResponse[]): number {
  const durations = items
    .map((item) => item.duration)
    .filter((value): value is number => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) return 1000;
  const median = durations[Math.floor(durations.length / 2)];
  return median > 100 ? 1000 : 1;
}

interface OEmbedMetadata {
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

/**
 * Fetch title and channel via YouTube's public oEmbed endpoint.
 *
 * This replaces scraping the ~1MB watch page with a ~300 byte documented
 * response, removing a round trip AND the fragile `"author":"(.*?)"` regex that
 * silently returned garbage from a consent wall. It also gives us a real
 * existence check: oEmbed 404s for a video that does not exist or is private,
 * so we can answer 404 instead of inventing a transcript.
 */
async function fetchVideoMetadata(videoId: string): Promise<OEmbedMetadata> {
  const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;

  const response = await fetchWithTimeout(target, { headers: BROWSER_HEADERS, timeoutMs: 5000 });

  // oEmbed answers 400 for an id it cannot resolve and 401/403/404 for one that
  // is private, deleted, or not embeddable. We have already validated the id's
  // shape, so any of these means "no publicly readable video here".
  if ([400, 401, 403, 404].includes(response.status)) {
    throw new AppError('VIDEO_NOT_FOUND', `No public YouTube video with id ${videoId}.`, { video_id: videoId });
  }
  if (response.status === 429) {
    throw new AppError('UPSTREAM_BLOCKED', 'YouTube is rate limiting this server. Please retry shortly.');
  }
  if (!response.ok) {
    throw new AppError('UPSTREAM_ERROR', `YouTube metadata lookup failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
  return {
    title: decodeEntities(payload.title?.trim() || `YouTube video ${videoId}`),
    channelTitle: decodeEntities(payload.author_name?.trim() || 'Unknown channel'),
    thumbnailUrl: payload.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/** Map the transcript library's error classes onto our taxonomy. */
function translateTranscriptError(error: unknown, videoId: string): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof YoutubeTranscriptDisabledError) {
    return new AppError('TRANSCRIPT_DISABLED', `Captions are disabled for video ${videoId}.`, { video_id: videoId });
  }
  if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
    return new AppError('LANGUAGE_UNAVAILABLE', error.message.replace('[YoutubeTranscript] 🚨 ', ''), {
      video_id: videoId,
    });
  }
  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return new AppError('TRANSCRIPT_UNAVAILABLE', `No captions are available for video ${videoId}.`, {
      video_id: videoId,
    });
  }
  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return new AppError('VIDEO_NOT_FOUND', `Video ${videoId} is no longer available.`, { video_id: videoId });
  }
  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return new AppError(
      'UPSTREAM_BLOCKED',
      'YouTube is throttling this server and is requesting a captcha. Retry shortly or route through a proxy pool.',
    );
  }
  return new AppError('UPSTREAM_ERROR', 'Transcript extraction failed against YouTube.', {
    hint: error instanceof Error ? error.message.slice(0, 160) : undefined,
  });
}

/**
 * Group raw caption cues into readable paragraphs.
 *
 * Cues arrive as fragments of a few words. Emitting one segment per cue makes an
 * unreadable wall; grouping to roughly a sentence keeps timestamps useful.
 */
function buildSegments(items: TranscriptResponse[], speaker: string): TranscriptSegment[] {
  const scale = detectTimeScale(items);
  const segments: TranscriptSegment[] = [];

  let chunk: string[] = [];
  let chunkStart = 0;
  let chunkEnd = 0;
  let index = 1;

  const flush = () => {
    if (chunk.length === 0) return;
    const start = Math.round(chunkStart * 100) / 100;
    const end = Math.round(Math.max(chunkEnd, chunkStart) * 100) / 100;
    segments.push({
      id: String(index++),
      start,
      duration: Math.round((end - start) * 100) / 100,
      end,
      formattedTime: formatTime(start),
      text: chunk.join(' '),
      speaker,
    });
    chunk = [];
  };

  for (const item of items) {
    const startSeconds = Number(item.offset) / scale;
    const durationSeconds = Number(item.duration) / scale;
    if (!Number.isFinite(startSeconds) || startSeconds < 0) continue;

    const text = decodeEntities(String(item.text ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    if (chunk.length === 0) chunkStart = startSeconds;
    chunk.push(text);
    chunkEnd = startSeconds + (Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0);

    if (chunk.length >= 3 || chunkEnd - chunkStart >= 12) flush();
  }

  // Flush unconditionally after the loop. The old code only flushed when the
  // LAST raw cue satisfied the grouping rule, so a trailing partial chunk — or
  // any transcript ending in a whitespace-only cue — was silently dropped.
  flush();

  return segments;
}

/**
 * Fetch the caption track, preferring English when the caller did not ask for a
 * language.
 *
 * Left to itself the upstream library takes whichever track YouTube lists first,
 * which is effectively arbitrary: Steve Jobs' Stanford address comes back in
 * Arabic. Asking for English first and falling back to YouTube's choice gives a
 * sensible default without hiding non-English content.
 */
async function fetchCaptions(videoId: string, lang?: string): Promise<TranscriptResponse[]> {
  if (lang) {
    return YoutubeTranscript.fetchTranscript(videoId, { fetch: boundFetch, lang });
  }

  try {
    return await YoutubeTranscript.fetchTranscript(videoId, { fetch: boundFetch, lang: 'en' });
  } catch (error) {
    // Only a missing English track justifies a second attempt; anything else
    // (disabled captions, throttling) would fail identically on retry.
    if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
      return YoutubeTranscript.fetchTranscript(videoId, { fetch: boundFetch });
    }
    throw error;
  }
}

const inFlight = new SingleFlight<VideoMetadata>();

/**
 * Extract a transcript. Resolves with real captions or throws a typed AppError.
 *
 * It never fabricates a placeholder transcript. The previous implementation
 * answered every failure with a stub segment reading "Transcript stream loaded."
 * under `success: true`, and cached it for seven days — so one transient YouTube
 * throttle poisoned that video with fake content for a week, indistinguishable
 * from a real result.
 */
export async function extractTranscript(videoId: string, lang?: string): Promise<VideoMetadata> {
  if (!VIDEO_ID.test(videoId)) {
    throw new AppError('INVALID_URL', 'Invalid YouTube video id.');
  }

  // Language changes the payload, so it must be part of the cache identity.
  const cacheKey = lang ? `${videoId}:${lang}` : videoId;

  const cached = getCached(cacheKey);
  if (cached) return cached;

  return inFlight.run(cacheKey, async () => {
    // Re-check: a concurrent caller may have populated the cache while we queued.
    const raced = getCached(cacheKey);
    if (raced) return raced;

    try {
      // Settled, not all: the transcript is the product and the title is
      // decoration. A video that blocks embedding still has usable captions, so
      // a metadata failure must not fail the request.
      const [metaResult, transcriptResult] = await Promise.allSettled([
        fetchVideoMetadata(videoId),
        fetchCaptions(videoId, lang),
      ]);

      if (transcriptResult.status === 'rejected') {
        // "This video does not exist" is more specific and more actionable than
        // whatever the transcript library reports for the same condition.
        if (
          metaResult.status === 'rejected' &&
          metaResult.reason instanceof AppError &&
          metaResult.reason.code === 'VIDEO_NOT_FOUND'
        ) {
          throw metaResult.reason;
        }
        throw translateTranscriptError(transcriptResult.reason, videoId);
      }

      const metadata: OEmbedMetadata =
        metaResult.status === 'fulfilled'
          ? metaResult.value
          : {
              title: `YouTube video ${videoId}`,
              channelTitle: 'Unknown channel',
              thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            };

      const rawTranscript = transcriptResult.value;
      const segments = buildSegments(rawTranscript ?? [], metadata.channelTitle);
      if (segments.length === 0) {
        throw new AppError('TRANSCRIPT_UNAVAILABLE', `Video ${videoId} returned an empty transcript.`, {
          video_id: videoId,
        });
      }

      const lastSegment = segments[segments.length - 1];
      const transcriptSpanSeconds = Math.ceil(lastSegment.end);

      const result: VideoMetadata = {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: metadata.title,
        channelTitle: metadata.channelTitle,
        durationFormatted: formatTime(transcriptSpanSeconds),
        durationSeconds: transcriptSpanSeconds,
        thumbnailUrl: metadata.thumbnailUrl,
        category: 'AI & Tech',
        upvotes: 0,
        language: lang ?? rawTranscript?.[0]?.lang ?? null,
        segments,
      };

      setCached(cacheKey, result);
      return result;
    } catch (error) {
      const appError = translateTranscriptError(error, videoId);

      // Only permanent facts about the video are remembered. Timeouts and
      // throttling are transient: caching them would serve a stale failure long
      // after the upstream recovered.
      if (appError.isTerminal) setCachedFailure(cacheKey, appError);
      throw appError;
    }
  });
}

/** Report cache state honestly, without a second lookup that mutates recency. */
export function isCachedTranscript(videoId: string, lang?: string): boolean {
  return hasCached(lang ? `${videoId}:${lang}` : videoId);
}
