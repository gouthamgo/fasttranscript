/**
 * Single source of truth for plans.
 *
 * The pricing page, the quota enforcer, the checkout session and the docs all
 * read from here, so a limit shown to a customer is by construction the limit
 * the server enforces.
 *
 * Pricing is set deliberately below the incumbent. TranscriptAPI charges $5/mo
 * for 1,000 credits ($5.00 per 1K) with top-ups at $1.50-$2.50 per 1K; the
 * broader market sits between $0.99 and $2.00 per 1K. Our marginal cost per
 * extraction is close to zero until proxy capacity is needed, so undercutting
 * on the headline number is both credible and defensible.
 */

export type PlanId = 'hobby' | 'starter' | 'pro';

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per month. */
  price: number;
  /** Successful extractions permitted per calendar month (UTC). */
  monthlyQuota: number;
  /** Sustained requests per minute; also the token-bucket burst size. */
  ratePerMinute: number;
  blurb: string;
  features: string[];
  highlight?: boolean;
  /** Stripe Price id, read from the environment so plans stay code-defined. */
  stripePriceEnv?: string;
}

export const PLANS: Record<PlanId, Plan> = {
  hobby: {
    id: 'hobby',
    name: 'Hobby',
    price: 0,
    monthlyQuota: 100,
    ratePerMinute: 15,
    blurb: 'Enough to build and ship a side project.',
    features: [
      '100 extractions / month',
      '15 requests / minute',
      'JSON, text, SRT & VTT',
      'No signup, no card',
    ],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 9,
    monthlyQuota: 5000,
    ratePerMinute: 120,
    blurb: 'For production apps and agents.',
    features: [
      '5,000 extractions / month',
      '120 requests / minute',
      '$1.80 per 1,000 — under every major competitor',
      'Email support',
    ],
    highlight: true,
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 39,
    monthlyQuota: 25000,
    ratePerMinute: 300,
    blurb: 'For high-volume platforms.',
    features: [
      '25,000 extractions / month',
      '300 requests / minute',
      '$1.56 per 1,000',
      'Priority support',
    ],
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS;
}

/** Effective price per 1,000 extractions — the number buyers actually compare. */
export function pricePerThousand(plan: Plan): number {
  if (plan.price === 0) return 0;
  return Math.round((plan.price / (plan.monthlyQuota / 1000)) * 100) / 100;
}
