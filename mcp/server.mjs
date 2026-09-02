#!/usr/bin/env node
/**
 * FastTranscript MCP server (stdio).
 *
 * Puts the API inside Claude Code, Claude Desktop, Cursor and anything else
 * speaking MCP — which is where developer distribution for this category now
 * happens. Implemented directly against the JSON-RPC wire protocol so it adds
 * no dependency to the project.
 *
 * Zero-friction by design: if no API key is configured it provisions a free one
 * on first use and caches it, so a user goes from install to working tool
 * without visiting a website or creating an account.
 *
 * Configure in an MCP client:
 *   {
 *     "mcpServers": {
 *       "fasttranscript": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/mcp/server.mjs"],
 *         "env": { "FASTTRANSCRIPT_BASE_URL": "https://your-domain.com" }
 *       }
 *     }
 *   }
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'fasttranscript', version: '1.0.0' };

const BASE_URL = (process.env.FASTTRANSCRIPT_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const KEY_CACHE = path.join(os.homedir(), '.fasttranscript', 'key.json');

/** Resolve an API key: environment first, then cache, then provision a free one. */
async function resolveApiKey() {
  if (process.env.FASTTRANSCRIPT_API_KEY) return process.env.FASTTRANSCRIPT_API_KEY;

  try {
    const cached = JSON.parse(fs.readFileSync(KEY_CACHE, 'utf8'));
    if (cached?.secret && cached.baseUrl === BASE_URL) return cached.secret;
  } catch {
    // No cache yet, or it belongs to a different deployment.
  }

  const response = await fetch(`${BASE_URL}/api/v1/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'MCP client' }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'Could not provision an API key.');
  }

  try {
    fs.mkdirSync(path.dirname(KEY_CACHE), { recursive: true });
    fs.writeFileSync(KEY_CACHE, JSON.stringify({ secret: payload.secret, baseUrl: BASE_URL }), { mode: 0o600 });
  } catch {
    // A read-only home directory just means we re-provision next run.
  }
  return payload.secret;
}

const TOOLS = [
  {
    name: 'get_transcript',
    description:
      'Fetch the timestamped transcript of a YouTube video. Returns real captions — never generated or guessed text. ' +
      'Fails clearly when a video has no captions rather than inventing them.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'YouTube URL or bare 11-character video id. Accepts watch, youtu.be, /shorts/, /embed/, /live/.',
        },
        format: {
          type: 'string',
          enum: ['json', 'text', 'srt', 'vtt'],
          description: 'Output format. Defaults to text, which is usually what a model wants.',
        },
        lang: {
          type: 'string',
          description: 'BCP-47 language tag, e.g. "en" or "pt-BR". Defaults to English when available.',
        },
      },
      required: ['url'],
    },
  },
];

async function callTool(name, args) {
  if (name !== 'get_transcript') throw new Error(`Unknown tool: ${name}`);

  const apiKey = await resolveApiKey();
  const params = new URLSearchParams({ url: String(args.url ?? '') });
  const format = args.format ?? 'text';
  params.set('format', format);
  if (args.lang) params.set('lang', String(args.lang));

  const response = await fetch(`${BASE_URL}/api/v1/transcript?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.text();

  if (!response.ok) {
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = `${parsed.error.code}: ${parsed.error.message}`;
    } catch {
      // Non-JSON error body; surface it as-is.
    }
    // Reported as an error result, not a protocol failure, so the model can react.
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  return { content: [{ type: 'text', text: body }] };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return fail(null, -32700, 'Parse error');
  }

  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case 'notifications/initialized':
        return; // Notification: no response.

      case 'tools/list':
        return respond(id, { tools: TOOLS });

      case 'tools/call':
        return respond(id, await callTool(params?.name, params?.arguments ?? {}));

      case 'ping':
        return respond(id, {});

      default:
        if (id === undefined) return; // Unknown notification: ignore.
        return fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    if (id === undefined) return;
    return fail(id, -32603, error instanceof Error ? error.message : 'Internal error');
  }
});
