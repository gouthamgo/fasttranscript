/**
 * Token-bucket rate limiting with a defensible client identity.
 *
 * Two things the previous fixed-window counter got wrong and this does not:
 *  - A fixed window lets a caller spend a full window's budget on each side of
 *    the boundary, i.e. 2x the advertised rate in an instant. A token bucket
 *    smooths refill and bounds the burst to the bucket size.
 *  - Keying on a raw, client-supplied X-Forwarded-For makes the limiter a no-op:
 *    a fresh header value buys a fresh budget. See `clientIdentity()`.
 */

const MAX_BUCKETS = 50_000;
const SWEEP_INTERVAL_MS = 60_000;

interface Bucket {
  tokens: number;
  lastRefill: number;
  /** Refill rate. May legitimately be below 1 (e.g. key issuance at 3/hour). */
  ratePerMinute: number;
  /** Maximum tokens the bucket holds — how large a burst is tolerated. */
  burst: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/**
 * Drop buckets that have refilled to full — they carry no state worth keeping.
 * Without this the map grows once per distinct key forever, which is an
 * unbounded-memory DoS for anything keyed on a spoofable header.
 */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS && buckets.size < MAX_BUCKETS) return;
  lastSweep = now;

  for (const [key, bucket] of buckets) {
    // Each bucket refills at its own rate, so the sweep must consult the bucket
    // rather than assume the rate of whichever request happened to trigger it.
    const refilled = bucket.tokens + ((now - bucket.lastRefill) / 60_000) * bucket.ratePerMinute;
    if (refilled >= bucket.burst) buckets.delete(key);
  }

  // Hard ceiling: if a flood outpaces the sweep, evict oldest-first rather than grow.
  if (buckets.size > MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until at least one token is available. */
  retryAfter: number;
}

/**
 * Consume one token.
 *
 * `burst` is the bucket capacity and defaults to one minute's worth of refill.
 * It must be tracked separately from the rate: a limit expressed per hour has a
 * per-minute rate below 1, and a bucket sized to that rate could never hold a
 * whole token, so every request — including the first — would be denied.
 */
export function checkRateLimit(
  key: string,
  ratePerMinute: number,
  burst: number = Math.max(1, ratePerMinute),
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key) ?? { tokens: burst, lastRefill: now, ratePerMinute, burst };
  const elapsedMinutes = (now - bucket.lastRefill) / 60_000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsedMinutes * ratePerMinute);
  bucket.lastRefill = now;
  bucket.ratePerMinute = ratePerMinute;
  bucket.burst = burst;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    const secondsPerToken = 60 / ratePerMinute;
    return {
      allowed: false,
      limit: burst,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) * secondsPerToken)),
    };
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return { allowed: true, limit: burst, remaining: Math.floor(bucket.tokens), retryAfter: 0 };
}

let warnedAboutIdentity = false;

/**
 * Best available identity for an unauthenticated caller.
 *
 * X-Forwarded-For is appended to by each proxy, so the entry a proxy adds is the
 * address of the peer it actually saw. Counting from the RIGHT at the number of
 * proxies we sit behind therefore lands on a value the client cannot forge;
 * counting from the left lands on whatever the client typed.
 *
 * Set FT_TRUST_PROXY_HOPS to the number of proxies in front of this app.
 *
 * It defaults to 0 — X-Forwarded-For is ignored entirely — because that is the
 * only safe default. Trusting one hop on a deployment that has no proxy hands
 * the limiter straight back to the attacker: they send the header themselves and
 * every request buys a fresh budget. Failing the other way merely groups callers
 * too aggressively, which is visible and fixable. Platform-set headers below are
 * trusted unconditionally, so Vercel and Cloudflare need no configuration.
 */
export function clientIdentity(headers: Headers, fallbackIp?: string): string {
  // Platform-set headers are written by infrastructure, not the client.
  const platform = headers.get('x-vercel-forwarded-for') ?? headers.get('cf-connecting-ip');
  if (platform) return `ip:${platform.trim()}`;

  const hops = Number(process.env.FT_TRUST_PROXY_HOPS ?? 0);
  if (Number.isFinite(hops) && hops > 0) {
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
      // Bound the work: a hostile header can be arbitrarily long.
      const parts = forwarded.split(',', 64).map((part) => part.trim()).filter(Boolean);
      const candidate = parts[parts.length - hops];
      if (candidate) return `ip:${candidate}`;
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) return `ip:${realIp.trim()}`;
  if (fallbackIp) return `ip:${fallbackIp}`;

  // No usable identity. Bucket these together but warn: on a misconfigured proxy
  // this collapses every caller into one budget, which is a visible outage
  // rather than a silent bypass — the safer of the two failure directions.
  if (!warnedAboutIdentity) {
    warnedAboutIdentity = true;
    console.warn(
      '[fasttranscript] Could not determine a client IP; these requests share a single rate-limit bucket. ' +
        'If this app runs behind a reverse proxy, set FT_TRUST_PROXY_HOPS to the number of proxies in front of it.',
    );
  }
  return 'ip:unidentified';
}

/** Standard rate-limit headers, so clients can back off without guessing. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}

/** Test/ops hook. */
export function resetRateLimits(): void {
  buckets.clear();
}
