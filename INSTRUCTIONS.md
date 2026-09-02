# FastTranscript

Timestamped YouTube transcripts as a web app and a metered REST API.
Next.js 14 (App Router) · TypeScript · Tailwind.

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3001
```

Production:

```bash
npm run build
npm run start        # http://localhost:3001
```

Copy `.env.example` to `.env` before deploying. Every value has a working
default, but two of them matter in production — see §6.

---

## 2. What it does

**Web app.** Paste a YouTube URL, get a searchable transcript beside the video.
Clicking a timestamp seeks the player; the highlight follows playback as it
runs. Export as Markdown or TXT. Transcript state lives in the URL
(`/?v=<video_id>`), so links are shareable and Back and Refresh behave.

**REST API.** `GET /api/v1/transcript` returns JSON, plain text, SRT or VTT.
Authenticated with a real server-side key, rate limited per plan, and metered
against a monthly quota.

Captions come from YouTube's own timed-text streams, so there is no
speech-to-text cost. Videos without captions cannot be transcribed — the API
says so with a 422 rather than inventing text.

---

## 3. API

### Create a key

```bash
curl -X POST http://localhost:3001/api/v1/keys \
  -H 'Content-Type: application/json' -d '{"name":"my app"}'
```

Returns the secret **once**. Only an HMAC of it is stored, so it cannot be
retrieved again — rotate if you lose it.

### Fetch a transcript

```bash
curl "http://localhost:3001/api/v1/transcript?url=https://www.youtube.com/watch?v=zjkBMFhNj_g" \
  -H "Authorization: Bearer ft_live_..."
```

| Parameter | Values | Notes |
|---|---|---|
| `url` | YouTube URL or bare 11-char id | Required. Accepts `watch`, `youtu.be`, `/shorts/`, `/embed/`, `/live/` |
| `format` | `json` (default), `text`, `srt`, `vtt` | |
| `lang` | BCP-47 tag, e.g. `en`, `pt-BR` | Defaults to the track YouTube picks |

Response headers report `X-Quota-Limit`, `X-Quota-Remaining`, `X-Quota-Reset`,
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-Cache: HIT|MISS`.

### Manage a key

```bash
curl http://localhost:3001/api/v1/keys -H "Authorization: Bearer ft_live_..."   # usage
curl -X POST http://localhost:3001/api/v1/keys -H "Authorization: Bearer ft_live_..." \
  -H 'Content-Type: application/json' -d '{"action":"rotate"}'                  # rotate
```

`{"action":"revoke"}` disables a key. Rotation carries usage across, so it
cannot be used to reset a quota.

### Errors

Failures return `{ "success": false, "error": { "code", "message" } }`. Branch
on `code`, never on the message text.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_URL`, `MISSING_PARAM` | Bad input |
| 401 | `UNAUTHORIZED`, `INVALID_KEY` | Missing, malformed, unknown or revoked key |
| 402 | `QUOTA_EXCEEDED` | Monthly allowance spent |
| 404 | `VIDEO_NOT_FOUND` | No public video with that id |
| 422 | `TRANSCRIPT_DISABLED`, `TRANSCRIPT_UNAVAILABLE`, `LANGUAGE_UNAVAILABLE` | Video exists, captions do not |
| 429 | `RATE_LIMITED` | Slow down; honour `Retry-After` |
| 502 | `UPSTREAM_BLOCKED`, `UPSTREAM_ERROR` | YouTube refused or failed. Retryable |
| 504 | `UPSTREAM_TIMEOUT` | Upstream deadline hit. Retryable |

A `2xx` always means real captions. Failures are never dressed up as success.

---

## 4. Plans

Defined once in `src/lib/plans.ts`; the pricing page and the quota enforcer both
read from it, so what a customer is shown is what the server applies.

| Plan | Price | Extractions / month | Per 1,000 | Requests / minute |
|---|---|---|---|---|
| Hobby | $0 | 100 | — | 15 |
| Starter | $9 | 5,000 | $1.80 | 120 |
| Pro | $39 | 25,000 | $1.56 | 300 |

Priced deliberately under the market. The incumbent charges $5/mo for 1,000
credits with top-ups at $1.50-$2.50 per 1,000; competitors sit between $0.99 and
$7.99 per 1,000. Marginal cost per extraction here is near zero until proxy
capacity is needed, so undercutting is both credible and defensible.

**Billing is live once Stripe is configured.** Set `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` and the `STRIPE_PRICE_*` ids, then point a webhook
endpoint at `/api/webhooks/stripe` for `checkout.session.completed`,
`customer.subscription.updated` and `customer.subscription.deleted`.

The webhook is the **only** path that changes a plan. `/api/v1/checkout` merely
starts a Checkout Session; it cannot grant quota, so a caller cannot upgrade
themselves by replaying it. Signatures are verified with a timing-safe compare
and a 5-minute timestamp tolerance — a tampered body with a valid signature is
rejected.

Without Stripe configured, `GET /api/v1/checkout` reports `configured: false`
and the pricing page renders an honest "Billing not connected yet" instead of a
button that does nothing.

---

## 5. Performance, stated accurately

- **Cache hit: ~20ms.** Repeat requests for the same video are served from an
  in-process LRU cache.
- **Cold extraction: roughly 0.5-2 seconds.** It requires live round trips to
  YouTube for metadata and the caption track. There is no sub-200ms cold path,
  and any claim of one is wrong.
- The cache is **per process**, bounded by bytes (default 256MB) and entry count.
  It is a latency optimisation, not shared infrastructure: a multi-instance
  deployment gets one cache per instance.
- Concurrent requests for the same cold video are collapsed into a single
  upstream call.
- Permanent failures (no such video, captions disabled) are negatively cached for
  ten minutes. Transient failures — timeouts, throttling — are never cached.

---

## 6. Deployment

**Two settings matter.**

`FT_KEY_SECRET` — the pepper for the key HMAC. If unset, one is generated and
persisted on first run, which is fine for a single instance and wrong for
several: each would generate its own and reject the others' keys. Set it
explicitly, identically, everywhere.

`FT_TRUST_PROXY_HOPS` — how many reverse proxies sit in front of the app.
Defaults to `0`, meaning `X-Forwarded-For` is ignored entirely, because trusting
it when there is no proxy lets any caller forge a fresh rate-limit bucket per
request. Set it to the real number behind nginx, Caddy or a load balancer.
Vercel and Cloudflare are detected from platform headers and need no value.

**Persistence.** API keys and usage counters are stored via `src/lib/store.ts`,
which defaults to an atomically-written JSON file under `FT_DATA_DIR`. That is
correct on any single long-lived Node process (VPS, Docker, Fly, Render).

On a read-only or ephemeral filesystem — Vercel, Lambda — it degrades to memory
and logs a warning: keys would not survive a cold start, and instances would not
share them. For serverless or multi-instance, implement the four-method `Store`
interface against Redis or Postgres and pass it to `configureStore()`. That is
the only seam that needs writing.

**Scraping reality.** YouTube throttles unauthenticated datacenter IPs. Expect
`UPSTREAM_BLOCKED` under load from a cloud host; a proxy pool is the usual
answer, and the cache absorbs the rest.

---

## 7. Layout

```
src/lib/
  errors.ts       Error taxonomy -> HTTP status mapping
  http.ts         Timeout-bound fetch, single-flight de-duplication
  store.ts        Pluggable persistence (file adapter by default)
  keys.ts         Key issue / verify / rotate / revoke, quota accounting
  plans.ts        Plan definitions — the single source of truth
  rateLimit.ts    Token bucket, trusted client identity
  cache.ts        Bounded LRU with negative caching
  youtubeExtractor.ts  URL parsing, caption fetch, segment building
  formats.ts      JSON / text / SRT / VTT serialisers
  apiClient.ts    Browser-side client (checks status, surfaces error codes)

src/app/api/
  extract/              POST — web app, anonymous, IP rate limited
  v1/transcript/        GET  — public API, key auth + quota
  v1/keys/              POST/GET — key lifecycle
  health/               GET  — liveness and cache stats
```

---

## 8. Growth surfaces

**Transcript pages.** Every video gets a server-rendered, indexable page at
`/transcript/<videoId>` carrying the full transcript text, canonical and
OpenGraph tags, and `VideoObject` structured data. Rendered on demand and cached
for a day, so a crawler sweeping thousands of URLs costs one upstream fetch per
video rather than one per request. `sitemap.xml` and `robots.txt` are generated.

This matters because the category leader takes 56% of ~6.4M monthly visits from
organic search. A single client-rendered page cannot compete for that; a page per
video can. The share button copies the `/transcript/<id>` URL, so every share
becomes an indexable asset.

**MCP server.** `mcp/server.mjs` exposes `get_transcript` over stdio to Claude
Code, Claude Desktop, Cursor and any other MCP client. No dependencies — it
speaks the JSON-RPC wire protocol directly.

```json
{
  "mcpServers": {
    "fasttranscript": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.mjs"],
      "env": { "FASTTRANSCRIPT_BASE_URL": "https://your-domain.com" }
    }
  }
}
```

If `FASTTRANSCRIPT_API_KEY` is unset it provisions a free key on first use and
caches it to `~/.fasttranscript/key.json`, so install-to-working-tool needs no
website visit and no account.

**The conversion path.** The API pitch sits in the reader beside a transcript
the user just successfully extracted — the highest-intent moment in the
product — rather than behind a nav tab.

---

## 9. Not done yet

- **Accounts.** Keys are bearer tokens with no user records behind them, so a
  key cannot be listed or recovered from another device. This is also what makes
  the no-signup flow possible; adding accounts should not remove it.
- **Proxy pool.** The hard problem in this business is not the code, it is not
  being blocked. YouTube throttles datacenter IPs, and `UPSTREAM_BLOCKED` will
  start firing under volume from a cloud host. Budget for residential proxies
  before anything else.
- **Fallback for captionless videos.** Every YouTube-only API in this market
  shares this gap, and buyer comparisons name it as the top weakness. A Whisper
  fallback would differentiate, but it breaks the zero-marginal-cost model and
  needs its own credit price.
- **Shared cache and store.** Both are per process by default; see §6.
