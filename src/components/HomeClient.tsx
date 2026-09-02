'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, X, AlertTriangle } from 'lucide-react';

import { Navbar } from '@/components/Navbar';
import { HeroInput } from '@/components/HeroInput';
import { DiscoveryGrid } from '@/components/DiscoveryGrid';
import { ReaderWorkspace } from '@/components/ReaderWorkspace';
import { DeveloperApiView } from '@/components/DeveloperApiView';
import { CURATED_VIDEOS } from '@/lib/curatedVideos';
import { extractTranscript, ApiClientError } from '@/lib/apiClient';
import { VideoMetadata } from '@/types';

type Tab = 'transcriber' | 'api';

export function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---- URL is the source of truth -----------------------------------------
  // Reading state from the query string is what makes a transcript link
  // shareable and makes Back and Refresh behave. Previously every piece of this
  // lived in component state, so the URL never changed from "/" and the share
  // button copied the homepage.
  const videoId = searchParams.get('v');
  const tab: Tab = searchParams.get('tab') === 'api' ? 'api' : 'transcriber';
  const category = searchParams.get('category') ?? 'All';
  // `?t=` arrives from timestamp links on the server-rendered transcript pages.
  const startAt = Number(searchParams.get('t')) || undefined;

  const [activeVideo, setActiveVideo] = useState<VideoMetadata | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** One timer, always cleared first, so overlapping errors cannot cut each other short. */
  const showError = useCallback((message: string) => {
    setError(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  const navigate = useCallback(
    (next: { v?: string | null; tab?: Tab; category?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const apply = (key: string, value: string | null | undefined, fallback?: string) => {
        if (value === undefined) return;
        if (value === null || value === fallback) params.delete(key);
        else params.set(key, value);
      };
      apply('v', next.v);
      apply('tab', next.tab, 'transcriber');
      apply('category', next.category, 'All');

      const query = params.toString();
      router.push(query ? `/?${query}` : '/', { scroll: false });
    },
    [router, searchParams],
  );

  // ---- Load the transcript named by the URL --------------------------------
  useEffect(() => {
    if (!videoId) {
      abortRef.current?.abort();
      setActiveVideo(null);
      setIsExtracting(false);
      return;
    }
    if (activeVideo?.id === videoId) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setIsExtracting(true);
    setActiveVideo(null);

    extractTranscript(videoId, controller.signal)
      .then((metadata) => {
        if (controller.signal.aborted) return;
        setActiveVideo(metadata);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        showError(
          err instanceof ApiClientError ? err.message : 'Extraction failed. Please check the link and try again.',
        );
        // Drop the unusable id from the URL so Refresh does not retry forever.
        navigate({ v: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsExtracting(false);
      });

    return () => controller.abort();
    // `activeVideo` is intentionally excluded: including it would re-run this
    // effect on every successful load and refetch immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, navigate, showError]);

  const handleExtract = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed || isExtracting) return;

      // Resolve locally so an obviously bad paste never costs a round trip.
      const id = resolveVideoId(trimmed);
      if (!id) {
        showError('That does not look like a YouTube link. Try https://www.youtube.com/watch?v=…');
        return;
      }
      navigate({ v: id, tab: 'transcriber' });
    },
    [isExtracting, navigate, showError],
  );

  const filteredVideos =
    category === 'All' ? CURATED_VIDEOS : CURATED_VIDEOS.filter((video) => video.category === category);

  return (
    <div className="min-h-screen flex flex-col bg-surface-light dark:bg-surface-dark text-zinc-950 dark:text-zinc-100 transition-colors">
      {/* role="alert" so screen readers announce failures; the old toast was silent. */}
      {error && (
        <div
          role="alert"
          className="fixed top-20 right-4 left-4 sm:left-auto sm:right-6 z-50 max-w-md p-4 rounded-xl bg-red-600 text-white text-sm shadow-2xl flex items-start gap-3"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <Navbar
        currentTab={tab}
        onTabChange={(next) => navigate({ tab: next })}
        onLogoClick={() => navigate({ v: null, tab: 'transcriber', category: 'All' })}
      />

      <main id="main" className="flex-1 pb-16">
        {tab === 'api' ? (
          <DeveloperApiView />
        ) : videoId ? (
          <ReaderWorkspace
            key={videoId}
            video={activeVideo}
            isLoading={isExtracting}
            startAt={startAt}
            onBack={() => navigate({ v: null })}
            onOpenApi={() => navigate({ tab: 'api' })}
          />
        ) : (
          <>
            <HeroInput
              onExtract={handleExtract}
              isLoading={isExtracting}
              selectedCategory={category}
              onSelectCategory={(next) => navigate({ category: next })}
            />
            <DiscoveryGrid
              videos={filteredVideos}
              category={category}
              onSelectVideo={(video) => navigate({ v: video.id })}
              onClearCategory={() => navigate({ category: 'All' })}
            />
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80 py-8 bg-white/50 dark:bg-zinc-950/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-zinc-900 dark:bg-white flex items-center justify-center text-white dark:text-zinc-900">
              <Zap className="w-3 h-3 fill-current" aria-hidden="true" />
            </span>
            <span className="font-bold text-zinc-900 dark:text-white">FastTranscript</span>
            <span>— timestamped transcripts from YouTube captions</span>
          </div>

          <nav className="flex items-center gap-6" aria-label="Footer">
            <button
              type="button"
              onClick={() => navigate({ tab: 'api' })}
              className="hover:text-zinc-900 dark:hover:text-white rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
            >
              Developer API
            </button>
            <button
              type="button"
              onClick={() => navigate({ v: null, tab: 'transcriber' })}
              className="hover:text-zinc-900 dark:hover:text-white rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
            >
              Explore feed
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * Client-side mirror of the server's id resolution.
 *
 * Kept deliberately strict and identical in spirit to `extractYouTubeId`: reject
 * non-YouTube hosts and any `v` value that is not exactly 11 characters, so a
 * malformed link is never silently truncated into a different valid video.
 */
function resolveVideoId(input: string): string | null {
  const ID = /^[A-Za-z0-9_-]{11}$/;
  if (ID.test(input)) return input;

  let url: URL;
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const allowed = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
  if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;

  const valid = (candidate: string | null | undefined) => (candidate && ID.test(candidate) ? candidate : null);
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return valid(segments[0]);
  if (segments[0] === 'watch') return valid(url.searchParams.get('v'));
  if (['shorts', 'embed', 'live', 'v', 'e'].includes(segments[0] ?? '')) return valid(segments[1]);
  return valid(url.searchParams.get('v'));
}
