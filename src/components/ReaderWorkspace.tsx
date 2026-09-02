'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Copy, Download, Check, ExternalLink, Play, Share2, Loader2, AlertCircle, ArrowRight } from 'lucide-react';

import { VideoMetadata } from '@/types';
import { copyToClipboard } from '@/lib/apiClient';

interface ReaderWorkspaceProps {
  video: VideoMetadata | null;
  isLoading: boolean;
  onBack: () => void;
  /** Seconds to seek to on open, from a `?t=` deep link on an SEO page. */
  startAt?: number;
  onOpenApi: () => void;
}

type CopyTarget = 'markdown' | 'txt' | 'link';

const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

export const ReaderWorkspace: React.FC<ReaderWorkspaceProps> = ({ video, isLoading, onBack, startAt, onOpenApi }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Seeks requested before the player was ready, replayed once it is. */
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const post = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), YOUTUBE_ORIGIN);
  }, []);

  /**
   * Two-way sync with the embedded player.
   *
   * Sending `{event:'listening'}` opens the channel YouTube uses to push
   * `infoDelivery` messages containing currentTime, which is what lets the
   * transcript follow playback. Previously the component only ever pushed
   * seek commands and never listened, so the highlight moved on click and then
   * sat still for the rest of the video.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only trust messages from the player origin.
      if (event.origin !== YOUTUBE_ORIGIN && event.origin !== 'https://www.youtube.com') return;

      let payload: { event?: string; info?: { currentTime?: number; playerState?: number } };
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;

      if (payload.event === 'onReady' || payload.event === 'initialDelivery') {
        setPlayerReady(true);
        if (pendingSeek.current !== null) {
          post({ event: 'command', func: 'seekTo', args: [pendingSeek.current, true] });
          post({ event: 'command', func: 'playVideo', args: [] });
          pendingSeek.current = null;
        }
      }

      const time = payload.info?.currentTime;
      if (typeof time === 'number' && Number.isFinite(time)) setCurrentTime(time);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  /** A `?t=` deep link from a transcript page should land on that moment. */
  useEffect(() => {
    if (startAt && startAt > 0) {
      setCurrentTime(startAt);
      pendingSeek.current = startAt;
    }
  }, [startAt]);

  /** Open the channel as soon as the iframe document loads. */
  const handleIframeLoad = useCallback(() => {
    post({ event: 'listening', id: 'ft-player', channel: 'widget' });
  }, [post]);

  const handleJumpToTime = useCallback(
    (seconds: number) => {
      setCurrentTime(seconds);
      if (!playerReady) {
        // Queue rather than drop: a click before the player finished loading
        // used to vanish silently with no feedback and no retry.
        pendingSeek.current = seconds;
        post({ event: 'listening', id: 'ft-player', channel: 'widget' });
        return;
      }
      post({ event: 'command', func: 'seekTo', args: [seconds, true] });
      post({ event: 'command', func: 'playVideo', args: [] });
    },
    [playerReady, post],
  );

  const flashCopied = (target: CopyTarget, ok: boolean) => {
    setCopyFailed(!ok);
    setCopied(ok ? target : null);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => {
      setCopied(null);
      setCopyFailed(false);
    }, 2500);
  };

  const filteredSegments = useMemo(() => {
    if (!video) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return video.segments;
    return video.segments.filter((segment) => segment.text.toLowerCase().includes(query));
  }, [video, searchQuery]);

  /** The last segment that has started — this is what makes the highlight track playback. */
  const activeSegmentId = useMemo(() => {
    if (!video) return null;
    let active = video.segments[0]?.id ?? null;
    for (const segment of video.segments) {
      if (segment.start <= currentTime + 0.25) active = segment.id;
      else break;
    }
    return active;
  }, [video, currentTime]);

  if (isLoading || !video) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to feed</span>
        </button>

        <div className="py-24 text-center" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 mx-auto animate-spin text-zinc-400" aria-hidden="true" />
          <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-white">Fetching captions…</p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            A cold video takes a second or two; repeat requests are served from cache.
          </p>
        </div>
      </div>
    );
  }

  const markdown =
    `# ${video.title}\n\n**Channel:** ${video.channelTitle}\n**Source:** ${video.url}\n\n## Transcript\n\n` +
    video.segments.map((segment) => `**[${segment.formattedTime}]** ${segment.text}`).join('\n\n');

  const plainText =
    `${video.title}\n${video.channelTitle} — ${video.url}\n\n` +
    video.segments.map((segment) => `[${segment.formattedTime}] ${segment.text}`).join('\n');

  const handleDownload = () => {
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${video.title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80)}_transcript.txt`;
    // Anchor must be in the document, and the object URL must outlive the click:
    // revoking synchronously aborts the download in Firefox and Safari.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    flashCopied('txt', true);
  };

  const toolbarButton =
    'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6 mb-6 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to feed</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={toolbarButton}
            onClick={async () => flashCopied('markdown', await copyToClipboard(markdown))}
          >
            {copied === 'markdown' ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{copied === 'markdown' ? 'Copied' : 'Copy Markdown'}</span>
          </button>

          <button type="button" className={toolbarButton} onClick={handleDownload}>
            {copied === 'txt' ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>Download TXT</span>
          </button>

          <button
            type="button"
            className={toolbarButton}
            // Share the canonical, server-rendered transcript page rather than
            // the client app view: it renders instantly for the recipient, and
            // every share becomes an indexable page.
            onClick={async () =>
              flashCopied('link', await copyToClipboard(`${window.location.origin}/transcript/${video.id}`))
            }
          >
            {copied === 'link' ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{copied === 'link' ? 'Link copied' : 'Share link'}</span>
          </button>
        </div>
      </div>

      {copyFailed && (
        <p role="alert" className="mb-4 flex items-center gap-2 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
          Clipboard access was blocked by the browser. Select the text and copy manually.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-5 flex flex-col gap-4 lg:sticky lg:top-24">
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-zinc-950 shadow-lg border border-zinc-200 dark:border-zinc-800">
            <iframe
              ref={iframeRef}
              onLoad={handleIframeLoad}
              // `origin` is required alongside enablejsapi=1; omitting it is the
              // most common cause of silently-ignored player commands.
              src={`${YOUTUBE_ORIGIN}/embed/${video.id}?enablejsapi=1&rel=0&origin=${encodeURIComponent(
                typeof window === 'undefined' ? '' : window.location.origin,
              )}`}
              title={`${video.title} — video player`}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>

          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm flex flex-col gap-3">
            <h1 className="font-bold text-base sm:text-lg text-zinc-950 dark:text-white leading-snug">{video.title}</h1>

            <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{video.channelTitle}</span>
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white font-medium rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
              >
                <span>Open on YouTube</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          <dl className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200/60 dark:border-zinc-800/60 text-xs text-zinc-700 dark:text-zinc-300 grid grid-cols-3 gap-2">
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Segments</dt>
              <dd className="font-semibold">{video.segments.length}</dd>
            </div>
            <div>
              {/* Named precisely: this is the span the captions cover, which is
                  not always the full runtime of the video. */}
              <dt className="text-zinc-500 dark:text-zinc-400">Captions span</dt>
              <dd className="font-semibold">{video.durationFormatted}</dd>
            </div>
            <div>
              <dt className="text-zinc-500 dark:text-zinc-400">Language</dt>
              <dd className="font-semibold uppercase">{video.language ?? '—'}</dd>
            </div>
          </dl>
          {/* The highest-intent moment in the product is the second a
              transcript appears. The API pitch belongs here, not buried in a
              nav tab. */}
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30">
            <p className="text-xs font-bold text-emerald-900 dark:text-emerald-300 mb-1">
              Need this in your code?
            </p>
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-300/80 mb-3 leading-relaxed">
              One GET request returns this as JSON, SRT or VTT. Free key, no signup, no card.
            </p>
            <code className="block text-[10px] font-mono bg-zinc-950 text-zinc-300 rounded-lg p-2.5 mb-3 overflow-x-auto whitespace-pre">
              {`GET /api/v1/transcript?url=${video.url}`}
            </code>
            <button
              type="button"
              onClick={onOpenApi}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              Get a free API key
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

        </div>

        <div className="lg:col-span-7 flex flex-col rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="relative flex-1">
              <label htmlFor="transcript-search" className="sr-only">
                Search transcript
              </label>
              <Search
                className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="transcript-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search this transcript…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-white placeholder-zinc-500 outline-none focus:border-zinc-900 dark:focus:border-white transition-colors"
              />
            </div>
            <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap" aria-live="polite">
              {searchQuery ? `${filteredSegments.length} match${filteredSegments.length === 1 ? '' : 'es'}` : `${video.segments.length} segments`}
            </span>
          </div>

          <ol className="p-2 sm:p-4 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-y-auto max-h-[70vh] list-none m-0">
            {filteredSegments.length === 0 ? (
              <li className="py-16 text-center text-zinc-600 dark:text-zinc-400 text-sm">
                No segments match “{searchQuery}”.
              </li>
            ) : (
              filteredSegments.map((segment) => {
                const isActive = activeSegmentId === segment.id;
                return (
                  <li key={segment.id}>
                    {/* One real button per row. The old markup nested a
                        non-functional <button> inside a clickable <div>, so the
                        timestamp was focusable but Enter did nothing — keyboard
                        users could not seek at all. */}
                    <button
                      type="button"
                      onClick={() => handleJumpToTime(segment.start)}
                      aria-current={isActive ? 'true' : undefined}
                      className={`w-full text-left py-3.5 px-3 rounded-xl transition-colors group flex items-start gap-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white ${
                        isActive
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-950 dark:text-white'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <span
                        className={`font-mono text-xs px-2 py-1 rounded-md flex items-center gap-1 shrink-0 transition-colors ${
                          isActive
                            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700'
                        }`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span className="sr-only">Jump to </span>
                        {segment.formattedTime}
                      </span>
                      <span className="flex-1 text-sm sm:text-base leading-relaxed">{segment.text}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ol>
        </div>
      </div>
    </div>
  );
};
