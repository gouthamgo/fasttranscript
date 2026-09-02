/**
 * Server-side API key issuance, verification, and monthly quota accounting.
 *
 * Design notes that matter for a paid API:
 *  - The secret is 128 bits from a CSPRNG and is shown to the caller exactly
 *    once. Only an HMAC of it is stored, so a leaked store cannot be replayed.
 *  - The HMAC output doubles as the record id, giving O(1) verification without
 *    ever holding plaintext.
 *  - Quota is consumed on the server, after a successful extraction. A client
 *    cannot spend, refund, or reset its own credits.
 */

import crypto from 'node:crypto';
import { getStore } from './store';
import { PLANS, PlanId, isPlanId } from './plans';
import { AppError } from './errors';

const KEY_PREFIX = 'apikey:';
// Reverse index so a Stripe webhook can find the key it belongs to.
const CUSTOMER_PREFIX = 'stripecustomer:';
const SECRET_KEY = 'config:key_secret';
const KEY_PATTERN = /^ft_live_[0-9a-f]{32}$/;

export interface ApiKeyRecord {
  id: string;
  /** First 16 chars of the secret, safe to display and log. */
  displayPrefix: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  usage: { periodStart: string; count: number };
  /** Set once a paid subscription is attached via Stripe checkout. */
  billing?: {
    customerId: string;
    subscriptionId: string | null;
    status: string;
  };
}

export interface QuotaState {
  plan: PlanId;
  limit: number;
  used: number;
  remaining: number;
  /** ISO timestamp at which the monthly counter rolls over. */
  resetsAt: string;
}

/**
 * Per-record async mutex. Read-modify-write on a usage counter must not
 * interleave, or concurrent requests silently undercount and give away credits.
 */
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(
    id,
    next.catch(() => undefined).finally(() => {
      if (locks.get(id) === next) locks.delete(id);
    }),
  );
  return next;
}

/**
 * Pepper for the key HMAC. Read from the environment in production; otherwise
 * generated once and persisted, because a per-boot random secret would silently
 * invalidate every previously issued key on restart.
 */
async function getPepper(): Promise<string> {
  const fromEnv = process.env.FT_KEY_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const store = getStore();
  const existing = await store.get<string>(SECRET_KEY);
  if (existing) return existing;

  const generated = crypto.randomBytes(32).toString('hex');
  await store.set(SECRET_KEY, generated);
  console.warn(
    '[fasttranscript] FT_KEY_SECRET is not set. A secret was generated and persisted to the data store. ' +
      'Set FT_KEY_SECRET explicitly before deploying to more than one instance.',
  );
  return generated;
}

async function hashSecret(secret: string): Promise<string> {
  const pepper = await getPepper();
  return crypto.createHmac('sha256', pepper).update(secret).digest('hex');
}

function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodResetsAt(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function quotaOf(record: ApiKeyRecord): QuotaState {
  const plan = PLANS[record.plan];
  const used = record.usage.periodStart === currentPeriod() ? record.usage.count : 0;
  return {
    plan: record.plan,
    limit: plan.monthlyQuota,
    used,
    remaining: Math.max(0, plan.monthlyQuota - used),
    resetsAt: periodResetsAt(),
  };
}

/** Public, non-secret view of a key — safe to return to a browser. */
export function publicView(record: ApiKeyRecord) {
  return {
    id: record.id,
    display_prefix: record.displayPrefix,
    name: record.name,
    plan: record.plan,
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt,
    revoked: record.revokedAt !== null,
    quota: quotaOf(record),
    billing_status: record.billing?.status ?? null,
  };
}

export async function issueKey(name: string, plan: PlanId = 'hobby'): Promise<{ secret: string; record: ApiKeyRecord }> {
  if (!isPlanId(plan)) throw new AppError('INVALID_URL', `Unknown plan: ${String(plan)}`);

  const secret = `ft_live_${crypto.randomBytes(16).toString('hex')}`;
  const id = await hashSecret(secret);

  const record: ApiKeyRecord = {
    id,
    displayPrefix: secret.slice(0, 16),
    name: name.trim().slice(0, 80) || 'Default key',
    plan,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
    usage: { periodStart: currentPeriod(), count: 0 },
  };

  await getStore().set(KEY_PREFIX + id, record);
  return { secret, record };
}

/** Verify a presented secret. Throws rather than returning null so callers cannot forget to check. */
export async function verifyKey(secret: string): Promise<ApiKeyRecord> {
  const trimmed = secret.trim();
  if (!KEY_PATTERN.test(trimmed)) {
    throw new AppError('INVALID_KEY', 'Malformed API key. Expected format: ft_live_<32 hex characters>.');
  }

  const id = await hashSecret(trimmed);
  const record = await getStore().get<ApiKeyRecord>(KEY_PREFIX + id);
  if (!record) throw new AppError('INVALID_KEY', 'Unknown API key.');
  if (record.revokedAt) throw new AppError('INVALID_KEY', 'This API key has been revoked.');
  return record;
}

/** Read quota without spending it. */
export async function getQuota(record: ApiKeyRecord): Promise<QuotaState> {
  return quotaOf(record);
}

/**
 * Spend one credit. Throws QUOTA_EXCEEDED when the monthly allowance is gone.
 * Call only after work succeeded — a failed extraction must not cost a credit.
 */
export async function consumeCredit(recordId: string): Promise<QuotaState> {
  return withLock(recordId, async () => {
    const store = getStore();
    const record = await store.get<ApiKeyRecord>(KEY_PREFIX + recordId);
    if (!record) throw new AppError('INVALID_KEY', 'Unknown API key.');

    const period = currentPeriod();
    if (record.usage.periodStart !== period) {
      record.usage = { periodStart: period, count: 0 };
    }

    const limit = PLANS[record.plan].monthlyQuota;
    if (record.usage.count >= limit) {
      throw new AppError('QUOTA_EXCEEDED', `Monthly quota of ${limit} extractions exhausted for the ${PLANS[record.plan].name} plan.`, {
        limit,
        resets_at: periodResetsAt(),
        upgrade: '/api#pricing',
      });
    }

    record.usage.count += 1;
    record.lastUsedAt = new Date().toISOString();
    await store.set(KEY_PREFIX + recordId, record);
    return quotaOf(record);
  });
}

export async function getKeyById(id: string): Promise<ApiKeyRecord | null> {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  return getStore().get<ApiKeyRecord>(KEY_PREFIX + id);
}

export async function revokeKey(id: string): Promise<void> {
  const record = await getKeyById(id);
  if (!record) throw new AppError('INVALID_KEY', 'Unknown API key.');
  record.revokedAt = new Date().toISOString();
  await getStore().set(KEY_PREFIX + id, record);
}

/**
 * Rotate: issue a replacement carrying the old key's plan and usage, then
 * revoke the old one. Usage carries over so rotation cannot reset a quota.
 */
export async function rotateKey(id: string): Promise<{ secret: string; record: ApiKeyRecord }> {
  const previous = await getKeyById(id);
  if (!previous) throw new AppError('INVALID_KEY', 'Unknown API key.');

  const issued = await issueKey(previous.name, previous.plan);
  issued.record.usage = { ...previous.usage };
  await getStore().set(KEY_PREFIX + issued.record.id, issued.record);
  await revokeKey(id);
  return issued;
}


/**
 * Attach or update a paid subscription.
 *
 * Called only from the verified Stripe webhook — never from a client request,
 * because a plan change is a change to what the customer is allowed to spend.
 */
export async function applySubscription(
  keyId: string,
  plan: PlanId,
  billing: { customerId: string; subscriptionId: string | null; status: string },
): Promise<ApiKeyRecord> {
  return withLock(keyId, async () => {
    const store = getStore();
    const record = await store.get<ApiKeyRecord>(KEY_PREFIX + keyId);
    if (!record) throw new AppError('INVALID_KEY', 'Unknown API key.');

    record.plan = plan;
    record.billing = billing;
    await store.set(KEY_PREFIX + keyId, record);
    // Index by customer so subscription.updated/deleted can resolve the key.
    await store.set(CUSTOMER_PREFIX + billing.customerId, keyId);
    return record;
  });
}

/** Resolve the key a Stripe customer belongs to. */
export async function keyIdForCustomer(customerId: string): Promise<string | null> {
  return getStore().get<string>(CUSTOMER_PREFIX + customerId);
}

/** Drop a key back to the free plan when a subscription lapses. */
export async function downgradeToHobby(keyId: string, status: string): Promise<void> {
  await withLock(keyId, async () => {
    const store = getStore();
    const record = await store.get<ApiKeyRecord>(KEY_PREFIX + keyId);
    if (!record) return;
    record.plan = 'hobby';
    if (record.billing) record.billing.status = status;
    await store.set(KEY_PREFIX + keyId, record);
  });
}
