import { Suspense } from 'react';
import { HomeClient } from '@/components/HomeClient';

/**
 * Rendered per request rather than prerendered.
 *
 * `useSearchParams` in a statically prerendered route forces Next to bail out to
 * client-side rendering, which shipped an empty shell: the served HTML contained
 * only the <title>, so crawlers and link previews saw a blank page. Rendering on
 * demand lets the query string resolve on the server and puts real content in
 * the response.
 */
export const dynamic = 'force-dynamic';

/**
 * Server shell. `useSearchParams` — which drives shareable transcript URLs —
 * must sit inside a Suspense boundary, so the interactive app lives in
 * HomeClient and this file only provides the boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-light dark:bg-surface-dark" />}>
      <HomeClient />
    </Suspense>
  );
}
