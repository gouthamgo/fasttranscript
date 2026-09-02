/**
 * Response serialisers for the public API.
 *
 * SRT and VTT are consumed by real subtitle tooling, so they have to be exactly
 * right. The previous SRT emitted `00:15,000 --> 00:15,999`: an MM:SS timecode
 * where the spec demands HH:MM:SS,mmm, and an end time derived from the start
 * rather than the duration, making every cue 999ms long no matter how long it
 * actually ran. Most players reject the first defect and desync on the second.
 */

import { VideoMetadata } from '../types';
import { formatTimecode } from './youtubeExtractor';

export type OutputFormat = 'json' | 'text' | 'srt' | 'vtt';

export const OUTPUT_FORMATS: OutputFormat[] = ['json', 'text', 'srt', 'vtt'];

export function isOutputFormat(value: string | null): value is OutputFormat {
  return value !== null && (OUTPUT_FORMATS as string[]).includes(value);
}

export function toPlainText(video: VideoMetadata): string {
  return video.segments.map((segment) => segment.text).join('\n');
}

export function toSrt(video: VideoMetadata): string {
  return (
    video.segments
      .map((segment, index) => {
        // Guarantee a strictly positive cue length even if upstream reports zero.
        const end = Math.max(segment.end, segment.start + 0.5);
        return [
          index + 1,
          `${formatTimecode(segment.start, ',')} --> ${formatTimecode(end, ',')}`,
          segment.text,
        ].join('\n');
      })
      .join('\n\n') + '\n'
  );
}

export function toVtt(video: VideoMetadata): string {
  const cues = video.segments.map((segment) => {
    const end = Math.max(segment.end, segment.start + 0.5);
    return `${formatTimecode(segment.start, '.')} --> ${formatTimecode(end, '.')}\n${segment.text}`;
  });
  return ['WEBVTT', '', ...cues.flatMap((cue) => [cue, ''])].join('\n');
}

export function toJson(video: VideoMetadata, meta: { cached: boolean; latencyMs: number }) {
  return {
    success: true as const,
    video_id: video.id,
    title: video.title,
    channel: video.channelTitle,
    /** Span covered by captions, in seconds. */
    duration_seconds: video.durationSeconds,
    language: video.language ?? null,
    cached: meta.cached,
    latency_ms: meta.latencyMs,
    segment_count: video.segments.length,
    segments: video.segments.map((segment) => ({
      start: segment.start,
      duration: segment.duration,
      end: segment.end,
      timestamp: segment.formattedTime,
      speaker: segment.speaker ?? null,
      text: segment.text,
    })),
  };
}

const CONTENT_TYPES: Record<Exclude<OutputFormat, 'json'>, string> = {
  text: 'text/plain; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

export function contentTypeFor(format: Exclude<OutputFormat, 'json'>): string {
  return CONTENT_TYPES[format];
}
