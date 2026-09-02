'use client';

import React from 'react';
import { Play, Search } from 'lucide-react';
import { CuratedVideo, thumbnailFor } from '@/lib/curatedVideos';

interface DiscoveryGridProps {
  videos: CuratedVideo[];
  category: string;
  onSelectVideo: (video: CuratedVideo) => void;
  onClearCategory: () => void;
}

export const DiscoveryGrid: React.FC<DiscoveryGridProps> = ({
  videos,
  category,
  onSelectVideo,
  onClearCategory,
}) => {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
          {category === 'All' ? 'Featured talks' : category}
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
          Pick one to pull its real transcript, or paste any YouTube link above.
        </p>
      </div>

      {/* Every filter needs an empty state. The "Podcasts" pill previously matched
          nothing and rendered blank whitespace with no explanation. */}
      {videos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 py-16 px-6 text-center">
          <Search className="w-6 h-6 mx-auto text-zinc-400 mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Nothing here yet</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
            No featured talks in {category}. Paste any YouTube link above — the transcriber works on every video
            with captions, featured or not.
          </p>
          <button
            type="button"
            onClick={onClearCategory}
            className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
          >
            Show all talks
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 list-none p-0">
          {videos.map((video) => (
            <li key={video.id} className="flex">
              {/* A real <button>, not a clickable <div>: focusable, Enter/Space
                  activated, and announced as a control by screen readers. */}
              <button
                type="button"
                onClick={() => onSelectVideo(video)}
                className="group w-full text-left rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm hover:shadow-glow-card transition-all flex flex-col overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
              >
                <span className="relative block aspect-video w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <img
                    src={thumbnailFor(video.id)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span className="absolute inset-0 bg-zinc-950/20 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="w-11 h-11 rounded-full bg-white/90 text-zinc-900 shadow-lg flex items-center justify-center scale-90 group-hover:scale-100 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" aria-hidden="true" />
                    </span>
                  </span>
                </span>

                <span className="p-4 flex-1 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 self-start">
                    {video.category}
                  </span>

                  <span className="font-bold text-sm sm:text-base text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-snug group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                    {video.title}
                  </span>

                  <span className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{video.blurb}</span>

                  <span className="mt-auto pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {video.channelTitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
