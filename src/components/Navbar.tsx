'use client';

import React from 'react';
import { Zap, Code2, FileText } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface NavbarProps {
  currentTab: 'transcriber' | 'api';
  onTabChange: (tab: 'transcriber' | 'api') => void;
  onLogoClick: () => void;
}

const TABS = [
  { id: 'transcriber', label: 'Transcripts', Icon: FileText },
  { id: 'api', label: 'Developer API', Icon: Code2 },
] as const;

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onTabChange, onLogoClick }) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md transition-colors">
      {/* Keyboard users can jump past the nav rather than tabbing it on every page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onLogoClick}
          className="flex items-center gap-2.5 group text-left rounded-lg shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
        >
          <span className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center text-white dark:text-zinc-900 shadow-sm group-hover:scale-105 transition-transform">
            <Zap className="w-4 h-4 fill-current" aria-hidden="true" />
          </span>
          <span className="font-bold text-lg tracking-tight text-zinc-900 dark:text-white">
            FastTranscript
          </span>
        </button>

        {/* Icon-only below `sm` so the bar cannot overflow a 375px viewport. */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-full border border-zinc-200/60 dark:border-zinc-800/60"
        >
          {TABS.map(({ id, label, Icon }) => {
            const isActive = currentTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onTabChange(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white ${
                  isActive
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sr-only sm:hidden">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
};
