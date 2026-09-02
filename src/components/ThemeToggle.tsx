'use client';

import React, { useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'ft-theme';

/**
 * Theme toggle with no hydration flash.
 *
 * The `dark` class is already applied by the inline script in the layout, so the
 * correct icon is chosen by CSS (`dark:hidden` / `hidden dark:block`) rather
 * than by React state. Deriving it from state would mean the server rendering
 * one icon and the client swapping it after hydration — a visible flicker on
 * every load, and a hydration mismatch warning.
 */
export function ThemeToggle() {
  const toggle = useCallback(() => {
    const isDark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Private browsing denies storage. The toggle still works for this page view.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-2 rounded-full text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
      aria-label="Toggle dark mode"
    >
      <Moon className="w-4 h-4 dark:hidden" aria-hidden="true" />
      <Sun className="w-4 h-4 hidden dark:block" aria-hidden="true" />
    </button>
  );
}
