/** @type {import('next').NextConfig} */

/**
 * Baseline security headers.
 *
 * None of these were present before, which left the app without clickjacking,
 * MIME-sniffing, or referrer protection. They are cheap and apply everywhere.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework and version to every caller.
  poweredByHeader: false,
  images: {
    // Thumbnails render through plain <img> (YouTube stills are already sized
    // and cached at the edge), so the optimizer is intentionally bypassed.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
