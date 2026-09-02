import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteUrl } from '@/lib/site';

export const metadata: Metadata = {
  // Absolute base so canonical and OpenGraph URLs resolve correctly.
  metadataBase: new URL(siteUrl()),
  title: 'FastTranscript — Timestamped Video Transcripts & Developer API',
  description:
    'Extract, search, and export timestamped transcripts from any YouTube video, with a metered REST API for developers and AI agents.',
  keywords: ['youtube transcript', 'video to text', 'transcript api', 'srt export', 'captions api'],
  authors: [{ name: 'FastTranscript' }],
};

/**
 * Next 14 wants viewport in its own export, not inside `metadata`.
 *
 * `maximum-scale` is deliberately absent: pinning it blocks pinch-zoom, which
 * fails WCAG 1.4.4 and makes small text unreadable for anyone who needs to
 * magnify it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

/**
 * Applies the stored theme before first paint.
 *
 * React cannot do this: it only runs after hydration, so a dark-mode visitor
 * would see a white flash on every page load. Kept tiny and failure-tolerant —
 * private-mode browsers throw on localStorage access.
 */
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('ft-theme');
  var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased bg-surface-light dark:bg-surface-dark transition-colors">
        {children}
      </body>
    </html>
  );
}
