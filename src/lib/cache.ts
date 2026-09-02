/**
 * Bounded LRU transcript cache.
 *
 * Three properties the previous version lacked and a paid API needs:
 *  - True LRU. Re-inserting on read means the hottest videos survive eviction;
 *    the old insertion-order map evicted whatever arrived first regardless of
 *    how often it was served.
 *  - A memory ceiling in BYTES, not entries. A transcript of a three-hour talk
 *    is megabytes; "10,000 entries" is an unbounded heap in disguise.
 *  - Negative caching that distinguishes permanent from transient failure. A
 *    video with captions disabled is worth remembering briefly; a timeout is
 *    never worth remembering, because remembering it serves a wrong answer
 *    long after the upstream recovered.
 *
 * Scope: this is per-process memory. It is a latency optimisation, not a shared
 * cache. Multi-instance deployments should front it with Redis via the same
 * get/set shape.
 */

import { VideoMetadata } from '../types';
import { AppError, AppErrorCode } from './errors';

const POSITIVE_TTL_MS = Number(process.env.FT_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
const NEGATIVE_TTL_MS = Number(process.env.FT_NEGATIVE_CACHE_TTL_MS ?? 10 * 60 * 1000);
const MAX_BYTES = Number(process.env.FT_CACHE_MAX_BYTES ?? 256 * 1024 * 1024);
const MAX_ENTRIES = Number(process.env.FT_CACHE_MAX_ENTRIES ?? 10_000);

type Entry =
  | { kind: 'ok'; data: VideoMetadata; storedAt: number; bytes: number }
  | { kind: 'error'; code: AppErrorCode; message: string; storedAt: number; bytes: number };

const cache = new Map<string, Entry>();
let totalBytes = 0;

const stats = { hits: 0, misses: 0, evictions: 0 };

function ttlFor(entry: Entry): number {
  return entry.kind === 'ok' ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
}

function drop(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  totalBytes -= entry.bytes;
  cache.delete(key);
}

function evictUntilWithinBudget(): void {
  // Map iteration order is insertion order; get() re-inserts, so the first key
  // is genuinely the least recently used.
  while ((totalBytes > MAX_BYTES || cache.size > MAX_ENTRIES) && cache.size > 0) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    drop(oldest);
    stats.evictions += 1;
  }
}

/**
 * Look up a cached result.
 * Returns the transcript on a positive hit, throws on a cached terminal
 * failure, and returns null on a miss.
 */
export function getCached(videoId: string): VideoMetadata | null {
  const entry = cache.get(videoId);
  if (!entry) {
    stats.misses += 1;
    return null;
  }

  if (Date.now() - entry.storedAt > ttlFor(entry)) {
    drop(videoId);
    stats.misses += 1;
    return null;
  }

  // Refresh recency.
  cache.delete(videoId);
  cache.set(videoId, entry);
  stats.hits += 1;

  if (entry.kind === 'error') {
    throw new AppError(entry.code, entry.message);
  }
  return entry.data;
}

/** True when a fresh entry of either kind exists — used to report `cached` honestly. */
export function hasCached(videoId: string): boolean {
  const entry = cache.get(videoId);
  if (!entry) return false;
  if (Date.now() - entry.storedAt > ttlFor(entry)) {
    drop(videoId);
    return false;
  }
  return true;
}

export function setCached(videoId: string, data: VideoMetadata): void {
  drop(videoId);
  const bytes = estimateBytes(data);
  // A single transcript larger than the whole budget is not worth caching.
  if (bytes > MAX_BYTES) return;
  cache.set(videoId, { kind: 'ok', data, storedAt: Date.now(), bytes });
  totalBytes += bytes;
  evictUntilWithinBudget();
}

/**
 * Remember a permanent failure so a known-bad video does not cost an upstream
 * round trip on every request. Callers must only pass terminal failures.
 */
export function setCachedFailure(videoId: string, error: AppError): void {
  if (!error.isTerminal) return;
  drop(videoId);
  const bytes = 256;
  cache.set(videoId, {
    kind: 'error',
    code: error.code,
    message: error.message,
    storedAt: Date.now(),
    bytes,
  });
  totalBytes += bytes;
  evictUntilWithinBudget();
}

function estimateBytes(data: VideoMetadata): number {
  // Rough but stable: 2 bytes per UTF-16 code unit of the serialised form.
  return JSON.stringify(data).length * 2;
}

export function cacheStats() {
  return {
    entries: cache.size,
    approx_bytes: totalBytes,
    max_bytes: MAX_BYTES,
    hits: stats.hits,
    misses: stats.misses,
    evictions: stats.evictions,
  };
}

export function clearCache(): void {
  cache.clear();
  totalBytes = 0;
}
