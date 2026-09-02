'use client';

/**
 * Browser-side API client.
 *
 * Every call funnels through `request()`, which checks `response.ok` and
 * surfaces the server's `error.code`. The old UI ignored status entirely and
 * rendered failures as green "200 OK", which is the single most misleading thing
 * a developer console can do.
 */

import { ApiKeyView, VideoMetadata } from '@/types';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

interface RawResult {
  status: number;
  ok: boolean;
  body: unknown;
  latencyMs: number;
}

/** Perform a request and always report the true status and elapsed time. */
export async function rawRequest(input: string, init?: RequestInit): Promise<RawResult> {
  const startedAt = performance.now();
  const response = await fetch(input, init);
  const latencyMs = Math.round(performance.now() - startedAt);

  let body: unknown = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, ok: response.ok, body, latencyMs };
}

function toError(result: RawResult): ApiClientError {
  const error = (result.body as { error?: { code?: string; message?: string } } | null)?.error;
  return new ApiClientError(
    error?.message ?? `Request failed with status ${result.status}.`,
    error?.code ?? 'UNKNOWN',
    result.status,
  );
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const result = await rawRequest(input, init);
  if (!result.ok) throw toError(result);
  return result.body as T;
}

export async function extractTranscript(url: string, signal?: AbortSignal): Promise<VideoMetadata> {
  const body = await request<{ metadata: VideoMetadata }>('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  return body.metadata;
}

export async function createApiKey(name: string): Promise<{ secret: string; key: ApiKeyView }> {
  return request('/api/v1/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function fetchApiKey(secret: string): Promise<ApiKeyView> {
  const body = await request<{ key: ApiKeyView }>('/api/v1/keys', {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return body.key;
}

export async function rotateApiKey(secret: string): Promise<{ secret: string; key: ApiKeyView }> {
  return request('/api/v1/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'rotate' }),
  });
}

export async function revokeApiKey(secret: string): Promise<void> {
  await request('/api/v1/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ action: 'revoke' }),
  });
}

export interface BillingStatus {
  configured: boolean;
  plans: Array<{ id: string; purchasable: boolean }>;
}

/** Whether this deployment can actually take money right now. */
export async function fetchBillingStatus(): Promise<BillingStatus> {
  return request<BillingStatus>('/api/v1/checkout');
}

/** Start a Stripe Checkout Session and return the URL to send the buyer to. */
export async function startCheckout(secret: string, plan: string): Promise<string> {
  const body = await request<{ url: string }>('/api/v1/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ plan }),
  });
  return body.url;
}

/**
 * Copy text, reporting failure instead of asserting success.
 *
 * `navigator.clipboard` is undefined on insecure origins and rejects when the
 * user denies permission. The old code fired it unawaited and flipped the button
 * to "Copied!" regardless, so a failed copy looked like a successful one.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
