import { NextRequest } from 'next/server';

import { issueKey, rotateKey, revokeKey, verifyKey, publicView } from '@/lib/keys';
import { checkRateLimit, clientIdentity, rateLimitHeaders } from '@/lib/rateLimit';
import { AppError } from '@/lib/errors';
import { corsPreflight, errorResponse, jsonResponse, readJsonBody } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Key minting is rate limited hard and separately from extraction.
 *
 * Without this, the free tier is unlimited by construction: a caller who hits
 * their 100-call quota simply mints another key. Capping issuance per IP is
 * what makes the quota mean anything.
 */
const KEYS_PER_HOUR = Number(process.env.FT_KEY_ISSUE_PER_HOUR ?? 3);

export function OPTIONS() {
  return corsPreflight();
}

/** Resolve the caller's own key from the Authorization header. */
async function requireKey(request: NextRequest) {
  const bearer = /^bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) {
    throw new AppError('UNAUTHORIZED', 'Send your key as `Authorization: Bearer ft_live_...`.');
  }
  return verifyKey(bearer);
}

/**
 * GET /api/v1/keys
 * Returns the authenticated key's plan and live server-side usage. Requires the
 * secret, so usage cannot be read by anyone who merely knows the key's id.
 */
export async function GET(request: NextRequest) {
  try {
    const record = await requireKey(request);
    return jsonResponse({ success: true, key: publicView(record) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/v1/keys
 *   { }                     -> issue a new Hobby key
 *   { action: 'rotate' }    -> replace the authenticated key, carrying usage over
 *   { action: 'revoke' }    -> disable the authenticated key
 *
 * The plaintext secret is returned exactly once, on issue and on rotate. It is
 * never stored: only an HMAC of it is, so it cannot be recovered or re-displayed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request).catch(() => ({}) as Record<string, unknown>);
    const action = typeof body.action === 'string' ? body.action : 'create';

    if (action === 'rotate') {
      const current = await requireKey(request);
      const { secret, record } = await rotateKey(current.id);
      return jsonResponse({ success: true, secret, key: publicView(record) });
    }

    if (action === 'revoke') {
      const current = await requireKey(request);
      await revokeKey(current.id);
      return jsonResponse({ success: true, revoked: current.id });
    }

    if (action !== 'create') {
      throw new AppError('INVALID_URL', `Unknown action "${action}". Use create, rotate or revoke.`);
    }

    // Paid plans are provisioned through checkout, never by asking for one.
    if (body.plan !== undefined && body.plan !== 'hobby') {
      throw new AppError(
        'UNAUTHORIZED',
        'Only Hobby keys can be self-issued. Paid plans are provisioned through checkout.',
      );
    }

    const identity = clientIdentity(request.headers, request.ip);
    // Refills at KEYS_PER_HOUR per hour, but a fresh IP may mint its full burst at once.
    const limit = checkRateLimit(`issue:${identity}`, KEYS_PER_HOUR / 60, KEYS_PER_HOUR);
    if (!limit.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        `Key issuance is limited to ${KEYS_PER_HOUR} per hour per IP.`,
        { retry_after_seconds: limit.retryAfter },
      );
    }

    const name = typeof body.name === 'string' ? body.name : 'Default key';
    const { secret, record } = await issueKey(name, 'hobby');

    return jsonResponse(
      { success: true, secret, key: publicView(record) },
      rateLimitHeaders(limit),
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
