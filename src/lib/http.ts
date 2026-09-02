/**
 * Outbound HTTP with a hard deadline.
 *
 * Node's global fetch has no default request timeout, so without this a slow
 * upstream pins a request handler (and, on serverless, a whole invocation)
 * until the platform kills it.
 */

import { AppError } from './errors';

const DEFAULT_TIMEOUT_MS = Number(process.env.FT_UPSTREAM_TIMEOUT_MS ?? 8000);

/** A desktop UA. YouTube serves consent walls and degraded payloads to obvious bots. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * fetch() that always settles: resolves, or throws an AppError with a code the
 * route layer can map to a status. Never leaves a dangling socket.
 */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Honour a caller-supplied signal in addition to our deadline.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new AppError('UPSTREAM_TIMEOUT', `Upstream request timed out after ${timeoutMs}ms`);
    }
    throw new AppError('UPSTREAM_ERROR', 'Could not reach YouTube', {
      hint: err instanceof Error ? err.message.slice(0, 120) : undefined,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/** A timeout-bound fetch shaped for injection into youtube-transcript's config. */
export const boundFetch: typeof globalThis.fetch = ((input: any, init?: any) =>
  fetchWithTimeout(typeof input === 'string' ? input : String(input), {
    ...(init ?? {}),
    headers: { ...BROWSER_HEADERS, ...(init?.headers ?? {}) },
  })) as typeof globalThis.fetch;

/**
 * Collapse concurrent identical work into one upstream call.
 *
 * Without this, N simultaneous requests for the same cold video each run a full
 * extraction chain against YouTube — the fastest way to get an origin IP blocked.
 */
export class SingleFlight<T> {
  private inFlight = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
