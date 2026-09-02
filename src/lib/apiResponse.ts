/**
 * Shared HTTP concerns for the API routes: CORS, error shaping, and the
 * rate-limit/quota headers a client needs in order to back off correctly.
 */

import { NextResponse } from 'next/server';
import { AppError, asAppError } from './errors';

/**
 * The public API is meant to be callable from a browser, so it must answer
 * preflights. `*` is correct here: authentication is a bearer token the caller
 * supplies explicitly, not an ambient cookie, so there is no cross-site request
 * forgery surface to protect.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function errorResponse(error: unknown, extraHeaders: Record<string, string> = {}): NextResponse {
  const appError = error instanceof AppError ? error : asAppError(error);
  return NextResponse.json(appError.toJSON(), {
    status: appError.status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

export function jsonResponse(body: unknown, extraHeaders: Record<string, string> = {}, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extraHeaders } });
}

export function textResponse(
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': contentType, ...extraHeaders },
  });
}

/** Parse a JSON body, reporting malformed input as the client error it is. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('MISSING_PARAM', 'Request body must be valid JSON.');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError('MISSING_PARAM', 'Request body must be a JSON object.');
  }
  return raw as Record<string, unknown>;
}
