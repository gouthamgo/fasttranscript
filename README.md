# FastTranscript

Timestamped YouTube transcripts as a web app and a metered REST API.
Next.js 14 (App Router) · TypeScript · Tailwind · zero runtime dependencies beyond the framework.

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3001
```

## What's here

**Web app** — paste a YouTube link, get a searchable transcript beside the video.
Clicking a timestamp seeks the player and the highlight follows playback. Export
as Markdown, TXT, SRT or VTT. Transcript state lives in the URL, so links are
shareable and Back/Refresh behave.

**REST API** — `GET /api/v1/transcript` returns JSON, text, SRT or VTT.
Server-side API keys, per-plan rate limiting, monthly quota metering, Stripe
subscriptions.

**Growth surfaces** — every video gets a server-rendered, indexable page at
`/transcript/<videoId>` with `VideoObject` structured data. An MCP server
(`mcp/server.mjs`) exposes the API to Claude Code, Cursor and any MCP client,
auto-provisioning a free key on first use.

## Design commitments

These are load-bearing; changing them changes what the product is.

1. **A `2xx` always means real captions.** Failures are never dressed up as
   success. Every error carries a stable `error.code` — branch on that, not on
   message text.
2. **Quota is spent server-side, only on success.** A failed extraction never
   costs a customer a credit, and a client cannot spend, refund or reset its own.
3. **Only a verified Stripe webhook may change a plan.** `/api/v1/checkout`
   starts a session and cannot grant quota, so replaying it upgrades nobody.
4. **Secrets are never rendered.** API keys are stored as an HMAC and shown once;
   code snippets read from `FASTTRANSCRIPT_API_KEY` rather than embedding a key,
   so they are safe to paste into a repo or a screen-share.
5. **Rate limiting fails closed.** `X-Forwarded-For` is ignored unless
   `FT_TRUST_PROXY_HOPS` says how many proxies to trust.

## Docs

[`INSTRUCTIONS.md`](./INSTRUCTIONS.md) — full API reference, error taxonomy,
plans, deployment, and what is deliberately not built yet.

## Before deploying

Set `FT_KEY_SECRET` (identical across instances), `FT_TRUST_PROXY_HOPS` to match
your topology, `NEXT_PUBLIC_SITE_URL`, and a writable `FT_DATA_DIR`. Stripe is
optional — without it the pricing page says billing is not connected rather than
showing a dead button.

The hard problem in this business is not the code, it is not being blocked:
YouTube throttles datacenter IPs, so budget for residential proxies before
anything else.
