/**
 * Typed error taxonomy.
 *
 * Every failure that can reach a client is one of these. Route handlers map
 * `code` -> HTTP status, so a caller can branch on a stable string instead of
 * parsing prose. Nothing here is ever presented to the caller as a success.
 */

export type AppErrorCode =
  | 'INVALID_URL'
  | 'MISSING_PARAM'
  | 'UNAUTHORIZED'
  | 'INVALID_KEY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'VIDEO_NOT_FOUND'
  | 'TRANSCRIPT_DISABLED'
  | 'TRANSCRIPT_UNAVAILABLE'
  | 'LANGUAGE_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_BLOCKED'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL';

const STATUS: Record<AppErrorCode, number> = {
  INVALID_URL: 400,
  MISSING_PARAM: 400,
  UNAUTHORIZED: 401,
  INVALID_KEY: 401,
  QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429,
  VIDEO_NOT_FOUND: 404,
  TRANSCRIPT_DISABLED: 422,
  TRANSCRIPT_UNAVAILABLE: 422,
  LANGUAGE_UNAVAILABLE: 422,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_BLOCKED: 502,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

/**
 * Failures we are confident are a permanent property of the video rather than
 * a transient upstream hiccup. Only these are safe to negative-cache.
 */
const TERMINAL: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'VIDEO_NOT_FOUND',
  'TRANSCRIPT_DISABLED',
  'TRANSCRIPT_UNAVAILABLE',
]);

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Extra machine-readable context merged into the JSON error body. */
  readonly details?: Record<string, unknown>;
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
    this.retryable = code === 'RATE_LIMITED' || (!TERMINAL.has(code) && this.status >= 500);
  }

  /** Safe to remember a negative result for this failure? */
  get isTerminal(): boolean {
    return TERMINAL.has(this.code);
  }

  toJSON() {
    return {
      success: false as const,
      error: { code: this.code, message: this.message, ...(this.details ?? {}) },
    };
  }
}

/** Narrow an unknown catch binding without `any`. */
export function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  // Internal messages are logged, never echoed verbatim to the caller.
  console.error('[fasttranscript] unhandled error:', err);
  return new AppError('INTERNAL', 'Internal server error', { hint: message.slice(0, 200) });
}
