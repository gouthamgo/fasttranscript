import type { PlanId } from '@/lib/plans';

export interface TranscriptSegment {
  id: string;
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds this segment spans. */
  duration: number;
  /** start + duration, in seconds. */
  end: number;
  /** "MM:SS", or "HH:MM:SS" for videos an hour or longer. */
  formattedTime: string;
  text: string;
  speaker?: string;
}

export interface VideoMetadata {
  id: string;
  url: string;
  title: string;
  channelTitle: string;
  channelAvatar?: string;
  /**
   * The span covered by captions, not necessarily the full video runtime:
   * YouTube's caption track can start late or stop before the credits.
   */
  durationFormatted: string;
  durationSeconds: number;
  viewCountFormatted?: string;
  publishedAt?: string;
  thumbnailUrl: string;
  category: VideoCategory;
  upvotes: number;
  /** BCP-47 tag of the caption track that was used, when YouTube reports one. */
  language?: string | null;
  segments: TranscriptSegment[];
  summaryBullets?: string[];
}

export const VIDEO_CATEGORIES = ['AI & Tech', 'YC Talks', 'Podcasts', 'Founders'] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export interface ExtractionResponse {
  success: true;
  source: 'cache' | 'network';
  latencyMs: number;
  metadata: VideoMetadata;
  fullText: string;
}

/** Shape of every failure the API returns. `error.code` is the stable contract. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

/** Non-secret view of an API key, as returned by /api/v1/keys. */
export interface ApiKeyView {
  id: string;
  display_prefix: string;
  name: string;
  plan: PlanId;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
  quota: {
    plan: PlanId;
    limit: number;
    used: number;
    remaining: number;
    resetsAt: string;
  };
  billing_status: string | null;
}
