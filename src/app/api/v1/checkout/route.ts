import { NextRequest } from 'next/server';

import { verifyKey } from '@/lib/keys';
import { isPlanId, PLANS } from '@/lib/plans';
import { createCheckoutSession, isConfigured, priceIdFor } from '@/lib/stripe';
import { AppError } from '@/lib/errors';
import { corsPreflight, errorResponse, jsonResponse, readJsonBody } from '@/lib/apiResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/** Report whether billing is live, so the UI never renders a dead button. */
export function GET() {
  return jsonResponse({
    configured: isConfigured(),
    plans: Object.values(PLANS)
      .filter((plan) => plan.price > 0)
      .map((plan) => ({ id: plan.id, purchasable: isConfigured() && Boolean(priceIdFor(plan.id)) })),
  });
}

/**
 * POST /api/v1/checkout  { plan: 'starter' | 'pro' }
 *
 * Starts a Stripe Checkout Session for the authenticated key. The upgrade is
 * NOT applied here — only the verified webhook may change a plan, so a caller
 * cannot grant themselves quota by replaying this request.
 */
export async function POST(request: NextRequest) {
  try {
    const bearer = /^bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!bearer) {
      throw new AppError('UNAUTHORIZED', 'Send your key as `Authorization: Bearer ft_live_...` to upgrade it.');
    }
    const record = await verifyKey(bearer);

    const body = await readJsonBody(request);
    const plan = body.plan;
    if (!isPlanId(plan) || PLANS[plan].price === 0) {
      throw new AppError('INVALID_URL', 'Choose a paid plan: starter or pro.');
    }

    if (!isConfigured()) {
      throw new AppError('INTERNAL', 'Billing is not connected on this deployment yet.');
    }

    const origin = request.headers.get('origin') ?? request.nextUrl.origin;
    const session = await createCheckoutSession({ keyId: record.id, plan, origin });

    return jsonResponse({ success: true, url: session.url });
  } catch (error) {
    return errorResponse(error);
  }
}
