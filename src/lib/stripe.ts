/**
 * Stripe integration over the REST API.
 *
 * Deliberately dependency-free: Checkout Sessions are a form-encoded POST and
 * webhook verification is an HMAC, so pulling in the SDK would add weight
 * without adding correctness.
 *
 * Everything here degrades cleanly when Stripe is unconfigured — `isConfigured()`
 * is false, checkout returns a clear error, and the pricing UI says billing is
 * not connected rather than presenting a button that silently fails.
 */

import crypto from 'node:crypto';
import { AppError } from './errors';
import { PLANS, PlanId } from './plans';

const STRIPE_API = 'https://api.stripe.com/v1';

export function isConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new AppError('INTERNAL', 'Billing is not configured on this deployment.', {
      hint: 'Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the STRIPE_PRICE_* variables.',
    });
  }
  return key;
}

/** Stripe Price id for a plan, or null when that plan has no price wired up. */
export function priceIdFor(plan: PlanId): string | null {
  const envName = PLANS[plan].stripePriceEnv;
  if (!envName) return null;
  return process.env[envName] ?? null;
}

async function stripeRequest<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });

  const payload = (await response.json()) as { error?: { message?: string }; [key: string]: unknown };
  if (!response.ok) {
    console.error('[fasttranscript] Stripe error:', payload.error);
    throw new AppError('INTERNAL', payload.error?.message ?? 'Stripe request failed.');
  }
  return payload as T;
}

/**
 * Create a Checkout Session for an existing API key.
 *
 * `client_reference_id` carries the key id through Stripe and back in the
 * webhook, which is what links a payment to the key it upgrades.
 */
export async function createCheckoutSession(options: {
  keyId: string;
  plan: PlanId;
  origin: string;
}): Promise<{ url: string }> {
  const priceId = priceIdFor(options.plan);
  if (!priceId) {
    throw new AppError('INTERNAL', `No Stripe price configured for the ${PLANS[options.plan].name} plan.`);
  }

  const session = await stripeRequest<{ url: string }>('/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: options.keyId,
    'metadata[key_id]': options.keyId,
    'metadata[plan]': options.plan,
    'subscription_data[metadata][key_id]': options.keyId,
    'subscription_data[metadata][plan]': options.plan,
    success_url: `${options.origin}/?tab=api&checkout=success`,
    cancel_url: `${options.origin}/?tab=api&checkout=cancelled`,
    allow_promotion_codes: 'true',
  });

  return { url: session.url };
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify a webhook signature and parse the event.
 *
 * Without this an unauthenticated POST could upgrade any key to Pro for free,
 * so the signature check is the security boundary for the whole billing flow.
 * Uses a timing-safe comparison and enforces a timestamp tolerance to reject
 * replayed payloads.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null, toleranceSeconds = 300): StripeEvent {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new AppError('UNAUTHORIZED', 'Webhook secret is not configured.');
  if (!signatureHeader) throw new AppError('UNAUTHORIZED', 'Missing Stripe-Signature header.');

  const parts = new Map(
    signatureHeader.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key.trim(), rest.join('=').trim()] as const;
    }),
  );

  const timestamp = parts.get('t');
  const provided = parts.get('v1');
  if (!timestamp || !provided) throw new AppError('UNAUTHORIZED', 'Malformed Stripe-Signature header.');

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    throw new AppError('UNAUTHORIZED', 'Webhook timestamp outside tolerance.');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new AppError('UNAUTHORIZED', 'Invalid webhook signature.');
  }

  return JSON.parse(rawBody) as StripeEvent;
}
