'use client';

import React, { useState } from 'react';
import { ArrowRight, Loader2, Link2 } from 'lucide-react';
import { VIDEO_CATEGORIES } from '@/types';

interface HeroInputProps {
  onExtract: (url: string) => void;
  isLoading: boolean;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

const CATEGORIES = ['All', ...VIDEO_CATEGORIES];

/** Labels verified against YouTube's oEmbed endpoint, not assumed. */
const SAMPLES = [
  { label: 'Steve Jobs at Stanford', url: 'https://www.youtube.com/watch?v=UF8uR6Z6KLc' },
  { label: 'Michael Seibel (YC)', url: 'https://www.youtube.com/watch?v=C27RVio2rOs' },
  { label: 'Karpathy on LLMs', url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g' },
];

export const HeroInput: React.FC<HeroInputProps> = ({
  onExtract,
  isLoading,
  selectedCategory,
  onSelectCategory,
}) => {
  const [urlInput, setUrlInput] = useState('');

  const submit = (value: string) => {
    // Every entry point honours the loading guard. The sample links used to
    // bypass it, so impatient clicking fired concurrent extractions straight
    // into the rate limiter.
    if (isLoading || !value.trim()) return;
    onExtract(value.trim());
  };

  return (
    <div className="w-full max-w-4xl mx-auto pt-12 pb-8 px-4 text-center">
      <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-6 shadow-sm">
        <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
        <span>Real YouTube captions · cached results in ~20ms</span>
      </p>

      <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-zinc-950 dark:text-white leading-[1.1] mb-4">
        Watch Less,{' '}
        <span className="underline decoration-zinc-300 dark:decoration-zinc-700 underline-offset-8">
          Read More.
        </span>
      </h1>

      <p className="max-w-2xl mx-auto text-base sm:text-lg text-zinc-600 dark:text-zinc-400 mb-8">
        Paste any YouTube link for a searchable, timestamped transcript you can copy, export, or query from an API.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(urlInput);
        }}
        className="relative max-w-2xl mx-auto mb-6"
      >
        <label htmlFor="video-url" className="sr-only">
          YouTube video URL
        </label>
        <div className="flex items-center rounded-2xl bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 shadow-glow-card focus-within:border-zinc-900 dark:focus-within:border-zinc-100 transition-all p-2 gap-2">
          <span className="pl-3 text-zinc-500 dark:text-zinc-400" aria-hidden="true">
            <Link2 className="w-5 h-5" />
          </span>

          <input
            id="video-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm sm:text-base text-zinc-900 dark:text-white placeholder-zinc-400"
            disabled={isLoading}
          />

          <button
            type="submit"
            disabled={!urlInput.trim() || isLoading}
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-950 text-sm font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>Extracting…</span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Extract Transcript</span>
                <span className="sm:hidden">Extract</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400 mb-10">
        <span>Quick try:</span>
        {SAMPLES.map((sample, index) => (
          <React.Fragment key={sample.url}>
            {index > 0 && <span aria-hidden="true">·</span>}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setUrlInput(sample.url);
                submit(sample.url);
              }}
              className="rounded underline underline-offset-2 decoration-zinc-300 dark:decoration-zinc-700 hover:text-zinc-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
            >
              {sample.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div
        role="group"
        aria-label="Filter by category"
        className="flex flex-wrap items-center justify-center gap-1.5 p-1 bg-zinc-100/80 dark:bg-zinc-900/80 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 max-w-fit mx-auto"
      >
        {CATEGORIES.map((category) => {
          const isActive = selectedCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              aria-pressed={isActive}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white ${
                isActive
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
};
