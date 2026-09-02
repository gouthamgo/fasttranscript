import { NextRequest, NextResponse } from 'next/server';

import { verifyWebhook } from '@/lib/stripe';
import { applySubscription, downgradeToHobby, keyIdForCustomer } from '@/lib/keys';
import { isPlanId } from '@/lib/plans';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. This is the ONLY place a plan changes.
 *
 * The raw body must be read as text, not JSON: signature verification runs over
 * the exact bytes Stripe signed, and re-serialising a parsed object would
 * change them and fail every check.
 */
export async function POST(request: NextRequest) {
  let event;
  try {
    const rawBody = await request.text();
    event = verifyWebhook(rawBody, request.headers.get('stripe-signature'));
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    console.warn('[fasttranscript] Rejected Stripe webhook:', error);
    return NextResponse.json({ received: false }, { status });
  }

  try {
    const object = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const keyId = (object.client_reference_id ?? (object.metadata as Record<string, string>)?.key_id) as
          | string
          | undefined;
        const plan = (object.metadata as Record<string, string>)?.plan;
        if (!keyId || !isPlanId(plan)) break;

        await applySubscription(keyId, plan, {
          customerId: String(object.customer ?? ''),
          subscriptionId: object.subscription ? String(object.subscription) : null,
          status: 'active',
        });
        console.info(`[fasttranscript] Upgraded key ${keyId.slice(0, 12)}… to ${plan}`);
        break;
      }

      case 'customer.subscription.updated': {
        const metadata = (object.metadata as Record<string, string>) ?? {};
        const keyId = metadata.key_id ?? (await keyIdForCustomer(String(object.customer ?? '')));
        const status = String(object.status ?? '');
        if (!keyId) break;

        // Anything other than a healthy subscription loses paid quota.
        if (['canceled', 'unpaid', 'incomplete_expired'].includes(status)) {
          await downgradeToHobby(keyId, status);
        } else if (isPlanId(metadata.plan)) {
          await applySubscription(keyId, metadata.plan, {
            customerId: String(object.customer ?? ''),
            subscriptionId: String(object.id ?? ''),
            status,
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = String(object.customer ?? '');
        const keyId =
          ((object.metadata as Record<string, string>) ?? {}).key_id ?? (await keyIdForCustomer(customerId));
        if (keyId) await downgradeToHobby(keyId, 'canceled');
        break;
      }

      default:
        break;
    }
  } catch (error) {
    // Return 500 so Stripe retries rather than dropping the event.
    console.error('[fasttranscript] Webhook handler failed:', error);
    return NextResponse.json({ received: false }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
