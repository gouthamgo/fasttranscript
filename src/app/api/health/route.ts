import { cacheStats } from '@/lib/cache';
import { jsonResponse } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness plus cache telemetry. Deliberately exposes no key or store contents. */
export function GET() {
  return jsonResponse({
    status: 'ok',
    uptime_seconds: Math.round(process.uptime()),
    cache: cacheStats(),
  });
}
