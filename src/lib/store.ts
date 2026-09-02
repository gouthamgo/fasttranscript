/**
 * Durable key/value persistence.
 *
 * The default adapter is a JSON file with atomic writes, which is correct on any
 * single-node host (VPS, Docker, Fly, Render, a long-lived Node process). It is
 * deliberately dependency-free.
 *
 * On a read-only or ephemeral filesystem (Vercel/Lambda) it degrades to memory
 * and logs a loud warning: API keys would not survive a cold start there, so a
 * multi-instance deployment must supply a shared adapter (Redis, Postgres) by
 * implementing `Store` and passing it to `configureStore()`. That is the single
 * seam between this codebase and a real database.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list<T>(prefix: string): Promise<Array<{ key: string; value: T }>>;
}

const DATA_DIR = process.env.FT_DATA_DIR ?? path.join(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

class FileStore implements Store {
  private data: Record<string, unknown> = {};
  private loaded = false;
  /** Serialises writes so two concurrent set() calls cannot interleave. */
  private writeChain: Promise<void> = Promise.resolve();
  private durable = true;

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DATA_FILE)) {
        this.data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Record<string, unknown>;
      }
    } catch (err) {
      this.durable = false;
      console.warn(
        `[fasttranscript] Data directory is not writable (${DATA_DIR}). ` +
          'Falling back to in-memory storage: API keys and usage counters will be LOST on restart. ' +
          'Set FT_DATA_DIR to a writable volume, or supply a shared Store adapter via configureStore().',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Write to a temp file then rename, so a crash mid-write cannot truncate the store. */
  private persist(): Promise<void> {
    if (!this.durable) return Promise.resolve();
    const snapshot = JSON.stringify(this.data);
    this.writeChain = this.writeChain
      .then(async () => {
        const tmp = `${DATA_FILE}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, snapshot, 'utf8');
        await fsp.rename(tmp, DATA_FILE);
      })
      .catch((err) => {
        console.error('[fasttranscript] Failed to persist store:', err);
      });
    return this.writeChain;
  }

  async get<T>(key: string): Promise<T | null> {
    this.load();
    return (this.data[key] as T) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.load();
    this.data[key] = value;
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    this.load();
    delete this.data[key];
    await this.persist();
  }

  async list<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    this.load();
    return Object.entries(this.data)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: value as T }));
  }
}

let store: Store = new FileStore();

/** Swap in a shared adapter (Redis, Postgres) for multi-instance deployments. */
export function configureStore(adapter: Store): void {
  store = adapter;
}

export function getStore(): Store {
  return store;
}
