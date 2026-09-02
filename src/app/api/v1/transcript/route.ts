import { NextRequest } from 'next/server';

import { extractTranscript, extractYouTubeId, isCachedTranscript } from '@/lib/youtubeExtractor';
import { verifyKey, consumeCredit, getQuota } from '@/lib/keys';
import { PLANS } from '@/lib/plans';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rateLimit';
import { AppError } from '@/lib/errors';
import { contentTypeFor, isOutputFormat, toJson, toPlainText, toSrt, toVtt } from '@/lib/formats';
import { corsPreflight, errorResponse, jsonResponse, textResponse } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/v1/transcript
 *
 * The metered, public endpoint. Every request is authenticated against a real
 * server-side key, rate limited per that key's plan, and charged exactly one
 * credit — and only when extraction actually succeeded.
 */
export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const params = request.nextUrl.searchParams;

  try {
    // ---- Authentication -----------------------------------------------------
    const authHeader = request.headers.get('authorization') ?? '';
    const bearer = /^bearer\s+(.+)$/i.exec(authHeader)?.[1];
    const presentedKey = (bearer ?? params.get('api_key') ?? '').trim();

    if (!presentedKey) {
      throw new AppError(
        'UNAUTHORIZED',
        'Missing API key. Send it as `Authorization: Bearer ft_live_...`. Create a free key at POST /api/v1/keys.',
      );
    }
    if (bearer === undefined && params.get('api_key')) {
      console.warn('[fasttranscript] API key supplied via query string; prefer the Authorization header.');
    }

    const keyRecord = await verifyKey(presentedKey);
    const plan = PLANS[keyRecord.plan];

    // ---- Rate limiting ------------------------------------------------------
    // Keyed on the verified key id, which is not client-forgeable.
    const limit = checkRateLimit(`key:${keyRecord.id}`, plan.ratePerMinute);
    if (!limit.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        `Rate limit of ${plan.ratePerMinute} requests/minute exceeded for the ${plan.name} plan.`,
        { retry_after_seconds: limit.retryAfter },
      );
    }

    // ---- Input validation ---------------------------------------------------
    const url = params.get('url') ?? params.get('v');
    if (!url) {
      throw new AppError(
        'MISSING_PARAM',
        'Missing required parameter `url` (e.g. ?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ).',
      );
    }

    const videoId = extractYouTubeId(url);
    if (!videoId) {
      throw new AppError('INVALID_URL', 'Could not resolve a YouTube video id from the supplied `url`.');
    }

    const formatParam = params.get('format');
    if (formatParam !== null && !isOutputFormat(formatParam)) {
      throw new AppError('INVALID_URL', `Unsupported format "${formatParam}". Use json, text, srt or vtt.`);
    }
    const format = formatParam ?? 'json';

    const lang = params.get('lang')?.trim() || undefined;
    if (lang && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) {
      throw new AppError('INVALID_URL', 'Parameter `lang` must be a BCP-47 language tag, e.g. "en" or "pt-BR".');
    }

    // ---- Quota check, then work, then charge --------------------------------
    const quotaBefore = await getQuota(keyRecord);
    if (quotaBefore.remaining <= 0) {
      throw new AppError(
        'QUOTA_EXCEEDED',
        `Monthly quota of ${quotaBefore.limit} extractions exhausted for the ${plan.name} plan.`,
        { limit: quotaBefore.limit, resets_at: quotaBefore.resetsAt },
      );
    }

    const cached = isCachedTranscript(videoId, lang);
    const video = await extractTranscript(videoId, lang);

    // Charged only now: a failed extraction must never cost the customer.
    const quota = await consumeCredit(keyRecord.id);
    const latencyMs = Date.now() - startedAt;

    const headers = {
      ...rateLimitHeaders(limit),
      'X-Quota-Limit': String(quota.limit),
      'X-Quota-Remaining': String(quota.remaining),
      'X-Quota-Reset': quota.resetsAt,
      'X-Cache': cached ? 'HIT' : 'MISS',
    };

    if (format === 'json') {
      return jsonResponse(toJson(video, { cached, latencyMs }), headers);
    }

    const body = format === 'text' ? toPlainText(video) : format === 'srt' ? toSrt(video) : toVtt(video);
    return textResponse(body, contentTypeFor(format), headers);
  } catch (error) {
    const headers: Record<string, string> = {};
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      headers['Retry-After'] = String((error.details?.retry_after_seconds as number) ?? 60);
    }
    return errorResponse(error, headers);
  }
}
