'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Code2, Copy, Check, Play, Eye, EyeOff, Activity, Clock, RefreshCw, Lock, AlertCircle, Loader2, KeyRound,
} from 'lucide-react';

import { PLANS, PLAN_IDS, pricePerThousand } from '@/lib/plans';
import { ApiKeyView } from '@/types';
import {
  copyToClipboard, createApiKey, fetchApiKey, fetchBillingStatus, rawRequest, rotateApiKey,
  startCheckout, ApiClientError, type BillingStatus,
} from '@/lib/apiClient';

const STORAGE_KEY = 'ft-api-key';
const DEMO_VIDEO = 'zjkBMFhNj_g';

type Language = 'curl' | 'python' | 'node' | 'ts';

interface RequestLog {
  id: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  at: number;
}

export const DeveloperApiView: React.FC = () => {
  const [activeLang, setActiveLang] = useState<Language>('curl');
  const [secret, setSecret] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<ApiKeyView | null>(null);
  const [justIssued, setJustIssued] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'key' | 'code' | null>(null);

  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [lastResponse, setLastResponse] = useState<{ status: number; ok: boolean; latencyMs: number; body: unknown } | null>(null);
  // Seeded empty on purpose. The old panel shipped three invented log entries
  // with hand-written relative times that never aged.
  const [logs, setLogs] = useState<RequestLog[]>([]);

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);

  // Ask the server whether it can take money, rather than assuming either way.
  useEffect(() => {
    fetchBillingStatus().then(setBilling).catch(() => setBilling({ configured: false, plans: [] }));
  }, []);

  // Snippets must point at the deployment the reader is actually looking at.
  // They previously hardcoded api.fasttranscript.com, so copy-paste never worked.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  /** Restore the stored key and refresh its usage from the server. */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!stored) return;

    setSecret(stored);
    fetchApiKey(stored)
      .then(setKeyInfo)
      .catch((err: unknown) => {
        // A revoked or unknown key should not linger in the UI pretending to work.
        if (err instanceof ApiClientError && err.status === 401) {
          try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
          setSecret(null);
          setKeyInfo(null);
        }
      });
  }, []);

  const persist = (value: string) => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* private mode */ }
  };

  const handleCreate = useCallback(async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const { secret: issued, key } = await createApiKey('Web dashboard key');
      setSecret(issued);
      setKeyInfo(key);
      setJustIssued(true);
      setShowKey(true);
      persist(issued);
    } catch (err) {
      setKeyError(err instanceof ApiClientError ? err.message : 'Could not create a key. Please try again.');
    } finally {
      setKeyBusy(false);
    }
  }, []);

  const handleRotate = useCallback(async () => {
    if (!secret) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const { secret: issued, key } = await rotateApiKey(secret);
      setSecret(issued);
      setKeyInfo(key);
      setJustIssued(true);
      setShowKey(true);
      persist(issued);
    } catch (err) {
      setKeyError(err instanceof ApiClientError ? err.message : 'Could not rotate the key.');
    } finally {
      setKeyBusy(false);
    }
  }, [secret]);

  const handleUpgrade = useCallback(async (plan: string) => {
    if (!secret) {
      setKeyError('Create a free key first — the subscription attaches to it.');
      return;
    }
    setCheckoutPlan(plan);
    setKeyError(null);
    try {
      window.location.href = await startCheckout(secret, plan);
    } catch (err) {
      setKeyError(err instanceof ApiClientError ? err.message : 'Could not start checkout.');
      setCheckoutPlan(null);
    }
  }, [secret]);

  const flash = (field: 'key' | 'code') => {
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const runSandbox = useCallback(async () => {
    if (!secret) return;
    setSandboxBusy(true);
    try {
      const result = await rawRequest(
        `/api/v1/transcript?url=https://www.youtube.com/watch?v=${DEMO_VIDEO}`,
        { headers: { Authorization: `Bearer ${secret}` } },
      );
      setLastResponse(result);
      setLogs((previous) => [
        { id: `${Date.now()}`, status: result.status, ok: result.ok, latencyMs: result.latencyMs, at: Date.now() },
        ...previous.slice(0, 4),
      ]);
      // Usage comes back from the server, never from a local counter.
      fetchApiKey(secret).then(setKeyInfo).catch(() => undefined);
    } catch {
      setLastResponse({ status: 0, ok: false, latencyMs: 0, body: { error: { code: 'NETWORK', message: 'Request failed to reach the server.' } } });
    } finally {
      setSandboxBusy(false);
    }
  }, [secret]);

  const displayKey = secret ?? 'ft_live_…';
  const maskedKey = showKey || !secret ? displayKey : `${displayKey.slice(0, 12)}${'•'.repeat(16)}${displayKey.slice(-4)}`;

  // Snippets never contain the live secret.
  //
  // Two reasons, and the second matters more. A rendered key leaks on any
  // screen-share, screenshot or demo recording. And a snippet that hardcodes a
  // credential teaches the pattern we do not want shipped — reading it from the
  // environment is what production code should do anyway. Nothing is lost:
  // "Run request" already exercises the endpoint with the real key.
  const KEY_ENV = 'FASTTRANSCRIPT_API_KEY';

  const snippets: Record<Language, string> = useMemo(() => {
    const base = origin || 'http://localhost:3001';
    const url = `${base}/api/v1/transcript?url=https://www.youtube.com/watch?v=${DEMO_VIDEO}`;
    return {
      curl: `curl "${url}" \\\n  -H "Authorization: Bearer $${KEY_ENV}"`,
      python: `import os
import requests

response = requests.get(
    "${base}/api/v1/transcript",
    headers={"Authorization": f"Bearer {os.environ['${KEY_ENV}']}"},
    params={"url": "https://www.youtube.com/watch?v=${DEMO_VIDEO}", "format": "json"},
    timeout=30,
)
response.raise_for_status()      # 402 = quota spent, 429 = slow down
data = response.json()

print(data["title"], "-", data["segment_count"], "segments")
for segment in data["segments"][:5]:
    print(f"[{segment['timestamp']}] {segment['text']}")`,
      node: `const response = await fetch(
  '${url}',
  { headers: { Authorization: \`Bearer \${process.env.${KEY_ENV}}\` } },
);

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(\`\${error.code}: \${error.message}\`);
}

const data = await response.json();
console.log(data.title, data.segment_count);`,
      ts: `interface Segment {
  start: number;
  duration: number;
  end: number;
  timestamp: string;
  speaker: string | null;
  text: string;
}

interface TranscriptResponse {
  success: true;
  video_id: string;
  title: string;
  channel: string;
  duration_seconds: number;
  language: string | null;
  cached: boolean;
  latency_ms: number;
  segment_count: number;
  segments: Segment[];
}

export async function fetchTranscript(videoUrl: string): Promise<TranscriptResponse> {
  const response = await fetch(
    \`${base}/api/v1/transcript?url=\${encodeURIComponent(videoUrl)}\`,
    { headers: { Authorization: \`Bearer \${process.env.${KEY_ENV}}\` } },
  );
  if (!response.ok) throw new Error((await response.json()).error.message);
  return response.json();
}`,
    };
  }, [origin]);

  const quota = keyInfo?.quota;
  const usedPercent = quota && quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="text-center max-w-3xl mx-auto mb-10">
        <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-semibold text-emerald-800 dark:text-emerald-400 mb-4">
          <Code2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Developer REST API</span>
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950 dark:text-white mb-3">
          Timestamped transcripts, one GET request away
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
          Real YouTube captions as JSON, plain text, SRT or VTT. Cached results return in about 20ms; a cold video
          takes a second or two.
        </p>
      </div>

      {/* ---- Key + quota ---- */}
      <div className="max-w-4xl mx-auto mb-10 grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-7 p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
              <Lock className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>
              <span className="text-xs font-bold text-zinc-900 dark:text-white block">
                {keyInfo ? keyInfo.name : 'No API key yet'}
              </span>
              <span className="text-[11px] text-zinc-600 dark:text-zinc-400 block">
                {keyInfo ? `${PLANS[keyInfo.plan].name} plan · issued ${new Date(keyInfo.created_at).toLocaleDateString()}` : 'Free, no signup required'}
              </span>
            </span>
          </div>

          {!secret ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={keyBusy}
              className="inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
            >
              {keyBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <KeyRound className="w-4 h-4" aria-hidden="true" />}
              <span>{keyBusy ? 'Creating…' : `Create a free key (${PLANS.hobby.monthlyQuota} calls/month)`}</span>
            </button>
          ) : (
            <>
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-zinc-800 dark:text-zinc-200 font-bold truncate">{maskedKey}</code>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    className="p-1.5 rounded-md text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
                    aria-label={showKey ? 'Hide API key' : 'Reveal API key'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    onClick={async () => { if (await copyToClipboard(secret)) flash('key'); }}
                    className="px-2.5 py-1 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
                  >
                    {copiedField === 'key' ? <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                    <span>{copiedField === 'key' ? 'Copied' : 'Copy'}</span>
                  </button>
                </span>
              </div>

              {justIssued && (
                <p role="status" className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                  {/* True statement: the server stores only an HMAC of this value. */}
                  <span>Copy this now — the server stores only a hash of it and cannot show it again.</span>
                </p>
              )}

              <div className="flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-400">
                <span>Saved in this browser. Call the API from your server, not from page scripts.</span>
                <button
                  type="button"
                  onClick={handleRotate}
                  disabled={keyBusy}
                  className="font-medium underline underline-offset-2 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1 disabled:opacity-50 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
                >
                  <RefreshCw className={`w-3 h-3 ${keyBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>Rotate</span>
                </button>
              </div>
            </>
          )}

          {keyError && (
            <p role="alert" className="text-[11px] text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
              {keyError}
            </p>
          )}
        </div>

        <div className="md:col-span-5 p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>Usage this month</span>
            </span>
            {keyInfo && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold">
                {PLANS[keyInfo.plan].name}
              </span>
            )}
          </div>

          {quota ? (
            <>
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-zinc-600 dark:text-zinc-400">{quota.used} / {quota.limit} used</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold">{quota.remaining} left</span>
              </div>
              <div
                className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={quota.used}
                aria-valuemin={0}
                aria-valuemax={quota.limit}
                aria-label="Monthly quota used"
              >
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${usedPercent}%` }} />
              </div>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-3">
                Counted server-side. Resets {new Date(quota.resetsAt).toLocaleDateString()}.
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Create a key to see live usage.</p>
          )}
        </div>
      </div>

      {/* ---- Playground ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-16 items-stretch">
        <div className="lg:col-span-7 rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-900/90 border-b border-zinc-800/80 gap-2">
            <div className="flex items-center gap-1 overflow-x-auto">
              {(['curl', 'python', 'node', 'ts'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setActiveLang(lang)}
                  aria-pressed={activeLang === lang}
                  className={`px-3 py-1 rounded-md text-xs font-mono font-medium transition-all whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    activeLang === lang ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {lang === 'ts' ? 'TypeScript' : lang === 'node' ? 'Node.js' : lang.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={runSandbox}
                disabled={sandboxBusy || !secret}
                title={secret ? undefined : 'Create an API key first'}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {sandboxBusy ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Play className="w-3 h-3 fill-current" aria-hidden="true" />}
                <span>{sandboxBusy ? 'Running…' : 'Run request'}</span>
              </button>
              <button
                type="button"
                onClick={async () => { if (await copyToClipboard(snippets[activeLang])) flash('code'); }}
                className="p-1.5 rounded-md text-zinc-400 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                aria-label="Copy code snippet"
              >
                {copiedField === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-5 flex-1 font-mono text-xs text-zinc-300 leading-relaxed overflow-x-auto">
            <pre className="whitespace-pre">{snippets[activeLang]}</pre>
          </div>
          <p className="px-4 sm:px-5 pb-4 text-[11px] text-zinc-500 font-sans">
            Set <code className="font-mono text-zinc-400">{KEY_ENV}</code> to the key above. Snippets never embed it,
            so they are safe to paste into a repo or a screen-share.
          </p>
        </div>

        <div className="lg:col-span-5 rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col">
          {/* Status and latency are read from the actual response. The old panel
              hardcoded "200 OK" and "3ms", so an error rendered as a success. */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900/90 border-b border-zinc-800/80">
            <span className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  !lastResponse ? 'bg-zinc-600' : lastResponse.ok ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-xs font-mono font-semibold text-zinc-200">
                {!lastResponse ? 'No request yet' : `${lastResponse.status} ${lastResponse.ok ? 'OK' : 'Error'}`}
              </span>
            </span>
            {lastResponse && (
              <span className={`text-[11px] font-mono font-bold ${lastResponse.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {lastResponse.latencyMs}ms
              </span>
            )}
          </div>

          <div className="p-4 flex-1 font-mono text-xs leading-relaxed overflow-auto max-h-[360px] bg-zinc-950/80">
            {lastResponse ? (
              <pre className={`whitespace-pre-wrap ${lastResponse.ok ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
                {JSON.stringify(lastResponse.body, null, 2)}
              </pre>
            ) : (
              <p className="text-zinc-500">
                {secret ? 'Press “Run request” to call the live endpoint.' : 'Create an API key to try the endpoint.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- Real request log ---- */}
      <div className="max-w-4xl mx-auto mb-16 p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <h2 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
          <span>Requests from this session</span>
        </h2>

        {logs.length === 0 ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 py-2">
            Nothing yet — requests you run above appear here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs font-mono list-none p-0 m-0">
            {logs.map((log) => (
              <li key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className={`px-2 py-0.5 rounded font-bold ${
                      log.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                        : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400'
                    }`}
                  >
                    {log.status}
                  </span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">/api/v1/transcript</span>
                </span>
                <span className="flex items-center gap-4 text-zinc-600 dark:text-zinc-400 shrink-0">
                  <span>{log.latencyMs}ms</span>
                  <span>{new Date(log.at).toLocaleTimeString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Pricing ---- */}
      <div id="pricing" className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Pricing</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Limits below are the limits the server enforces.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLAN_IDS.map((planId) => {
            const plan = PLANS[planId];
            const isCurrent = keyInfo?.plan === planId;
            const purchasable =
              billing?.configured === true && billing.plans.some((entry) => entry.id === planId && entry.purchasable);
            return (
              <div
                key={plan.id}
                className={`p-6 rounded-2xl bg-white dark:bg-zinc-900 flex flex-col justify-between shadow-sm ${
                  plan.highlight
                    ? 'border-2 border-emerald-500 shadow-glow-brand relative'
                    : 'border border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 right-6 px-2.5 py-0.5 rounded-full bg-emerald-500 text-zinc-950 font-bold text-[10px] tracking-wider uppercase">
                    Most popular
                  </span>
                )}
                <div>
                  <h3 className="font-bold text-lg text-zinc-900 dark:text-white">{plan.name}</h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{plan.blurb}</p>
                  <p className="my-6">
                    <span className="text-4xl font-extrabold text-zinc-950 dark:text-white">${plan.price}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400 ml-1">/ month</span>
                    {plan.price > 0 && (
                      <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
                        ${pricePerThousand(plan).toFixed(2)} per 1,000 extractions
                      </span>
                    )}
                  </p>
                  <ul className="space-y-3 text-xs text-zinc-700 dark:text-zinc-300 mb-6 list-none p-0">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-px" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* No fake checkout. The free plan is genuinely self-serve; the
                    paid plans say plainly that billing is not connected yet
                    rather than rendering a button that silently does nothing. */}
                {plan.price === 0 ? (
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={keyBusy || Boolean(secret)}
                    className="w-full py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 font-semibold text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-60 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white"
                  >
                    {isCurrent ? 'Your current plan' : 'Get a free key'}
                  </button>
                ) : isCurrent ? (
                  <p className="w-full py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-center font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                    Your current plan
                  </p>
                ) : purchasable ? (
                  <button
                    type="button"
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={checkoutPlan !== null}
                    className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white ${
                      plan.highlight
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                        : 'border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {checkoutPlan === plan.id ? 'Opening checkout…' : `Subscribe — $${plan.price}/mo`}
                  </button>
                ) : (
                  // Truthful when Stripe is not wired up, instead of a button
                  // that looks live and does nothing.
                  <p className="w-full py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-center font-semibold text-xs text-zinc-700 dark:text-zinc-300">
                    Billing not connected yet
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
