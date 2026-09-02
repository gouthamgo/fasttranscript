import { NextRequest } from 'next/server';

import { extractTranscript, extractYouTubeId, isCachedTranscript } from '@/lib/youtubeExtractor';
import { checkRateLimit, clientIdentity, rateLimitHeaders } from '@/lib/rateLimit';
import { AppError } from '@/lib/errors';
import { ExtractionResponse } from '@/types';
import { corsPreflight, errorResponse, jsonResponse, readJsonBody } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Anonymous browser traffic gets a modest shared allowance. */
const ANONYMOUS_RATE_PER_MINUTE = Number(process.env.FT_ANON_RATE_PER_MINUTE ?? 15);

export function OPTIONS() {
  return corsPreflight();
}

/**
 * POST /api/extract
 *
 * Powers the web app. Unauthenticated and IP rate limited; the metered,
 * key-authenticated surface is /api/v1/transcript.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const identity = clientIdentity(request.headers, request.ip);
    const limit = checkRateLimit(identity, ANONYMOUS_RATE_PER_MINUTE);
    if (!limit.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        `Too many requests. This endpoint allows ${ANONYMOUS_RATE_PER_MINUTE} extractions per minute. ` +
          'Create a free API key for a higher, metered allowance.',
        { retry_after_seconds: limit.retryAfter },
      );
    }

    const body = await readJsonBody(request);
    const { url } = body;

    if (url === undefined || url === null || url === '') {
      throw new AppError('MISSING_PARAM', 'A YouTube URL or video id is required.');
    }
    if (typeof url !== 'string') {
      throw new AppError('MISSING_PARAM', 'Field `url` must be a string.');
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      throw new AppError(
        'INVALID_URL',
        'That does not look like a YouTube link. Paste a URL such as https://www.youtube.com/watch?v=dQw4w9WgXcQ.',
      );
    }

    const cached = isCachedTranscript(videoId);
    const metadata = await extractTranscript(videoId);

    const payload: ExtractionResponse = {
      success: true,
      source: cached ? 'cache' : 'network',
      latencyMs: Date.now() - startedAt,
      metadata,
      fullText: metadata.segments.map((segment) => `[${segment.formattedTime}] ${segment.text}`).join('\n'),
    };

    return jsonResponse(payload, { ...rateLimitHeaders(limit), 'X-Cache': cached ? 'HIT' : 'MISS' });
  } catch (error) {
    const headers: Record<string, string> = {};
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      headers['Retry-After'] = String((error.details?.retry_after_seconds as number) ?? 60);
    }
    return errorResponse(error, headers);
  }
}
