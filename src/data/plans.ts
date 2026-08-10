import type { PlanTier } from './types';

export interface PlanFeature {
  label: string;
  included: boolean;
  /** Included identically on every tier (e.g. Team Chat Messenger) — always rendered in the "all plans" accent. */
  allPlans?: boolean;
  /** A cost/fee line rather than a capability (e.g. Stripe payments + platform fee) — rendered in the fee accent. */
  fee?: boolean;
  /** Indented detail lines shown under this feature, e.g. the Stripe fee breakdown under "Stripe payments". */
  subItems?: string[];
}

export type BillingInterval = 'year' | 'month';

export interface PlanPricing {
  year: { amountCents: number };
  month: { amountCents: number };
}

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  /** Short one-line description shown under the plan name, e.g. "For individual coaches". */
  tagline: string;
  highlight?: boolean;
  /** null for the Free tier, which has no Stripe pricing at all. */
  pricing: PlanPricing | null;
  features: PlanFeature[];
  limits: {
    assessments: number | 'unlimited';
    players: number | 'unlimited';
    teams: number | 'unlimited';
    customRubrics: number | 'unlimited';
    teamBuilder: boolean;
    aiSummaries: boolean;
    exports: ('csv' | 'pdf' | 'xlsx')[];
    shareLinks: boolean;
    seasonHub: boolean;
    guardianPortal: boolean;
    enterprise: boolean;
    qrRegistration: boolean;
    /** Stripe payment collection (+ 0.5% TryoutHQ platform fee) for this tier. */
    payments: boolean;
  };
}

/** Stripe's own cut, shown as a sub-item under "Stripe payments" on every paid tier. */
const STRIPE_FEE_SUBITEMS = ['0.5% of registration fees collected', 'Stripe: 2.9% + CAD$0.30 per transaction'];

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: 'free',
    name: 'Free',
    tagline: 'Try it out — no credit card needed',
    pricing: null,
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: '1 team', included: true },
      { label: '1 assessment', included: true },
      { label: '15 players', included: true },
      { label: 'QR registration', included: true },
      { label: 'Basic scoring', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'Stripe payments', included: false, fee: true },
      { label: '0.5% platform fee', included: false, fee: true },
      { label: 'AI summaries', included: false },
      { label: 'PDF exports', included: false },
      { label: 'Dashboard', included: false },
    ],
    limits: {
      assessments: 1,
      players: 15,
      teams: 1,
      customRubrics: 0,
      teamBuilder: false,
      aiSummaries: false,
      exports: [],
      shareLinks: false,
      seasonHub: false,
      guardianPortal: false,
      enterprise: false,
      qrRegistration: true,
      payments: false,
    },
  },
  {
    tier: 'coach',
    name: 'Coach',
    tagline: 'For individual coaches',
    pricing: { year: { amountCents: 3999 }, month: { amountCents: 400 } },
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: '1 team', included: true },
      { label: 'Unlimited assessments', included: true },
      { label: '30 players', included: true },
      { label: 'QR registration & cloud sync', included: true },
      { label: 'CSV export', included: true },
      { label: 'Season Hub (basic)', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'Basic payment dashboard', included: true },
      { label: 'Guardian portal (basic)', included: true },
      { label: 'AI summaries', included: false },
      { label: 'PDF exports', included: false },
    ],
    limits: {
      assessments: 'unlimited',
      players: 30,
      teams: 1,
      customRubrics: 5,
      teamBuilder: false,
      aiSummaries: false,
      exports: ['csv'],
      shareLinks: false,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      qrRegistration: true,
      payments: true,
    },
  },
  {
    tier: 'coach_plus',
    name: 'Coach+',
    tagline: 'For serious coaches & rep teams',
    highlight: true,
    pricing: { year: { amountCents: 6999 }, month: { amountCents: 700 } },
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: '2 teams', included: true },
      { label: 'Unlimited assessments', included: true },
      { label: '100 players', included: true },
      { label: 'Everything in Coach', included: true },
      { label: 'Enhanced payment dashboard', included: true },
      { label: 'Per player fee breakdown', included: true },
      { label: 'Historical player profiles', included: true },
      { label: 'AI player summaries', included: true },
      { label: 'AI Team Builder', included: true },
      { label: 'PDF export & share links', included: true },
      { label: 'Guardian portal emails', included: true },
      { label: 'Player comparisons', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 100,
      teams: 2,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      qrRegistration: true,
      payments: true,
    },
  },
  {
    tier: 'club',
    name: 'Club',
    tagline: 'For clubs & organizations of any size',
    pricing: { year: { amountCents: 9999 }, month: { amountCents: 1000 } },
    features: [
      { label: 'Team Chat Messenger', included: true, allPlans: true },
      { label: 'Stripe payments', included: true, fee: true, subItems: STRIPE_FEE_SUBITEMS },
      { label: 'Unlimited teams', included: true },
      { label: 'Unlimited assessments', included: true },
      { label: 'Unlimited players', included: true },
      { label: 'Everything in Coach+', included: true },
      { label: 'Full association dashboard', included: true },
      { label: 'Registration intake management', included: true },
      { label: 'Age group reporting', included: true },
      { label: 'Friend / teammate requests', included: true },
      { label: 'License purchasing', included: true },
      { label: 'Multi-staff roles & access', included: true },
      { label: 'White-label PDF exports', included: true },
      { label: 'Bulk CSV import', included: true },
      { label: 'Priority support', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 'unlimited',
      teams: 'unlimited',
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf', 'xlsx'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: true,
      qrRegistration: true,
      payments: true,
    },
  },
];

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  return PLAN_DEFINITIONS.find((p) => p.tier === tier) ?? PLAN_DEFINITIONS[1];
}

export function canUseFeature(tier: PlanTier, feature: keyof PlanDefinition['limits']): boolean {
  const plan = getPlanDefinition(tier);
  const val = plan.limits[feature];
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.length > 0;
  if (val === 'unlimited') return true;
  return (val as number) > 0;
}

export function isAtAssessmentLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.assessments;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

export function isAtPlayerLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.players;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

export function isAtTeamLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.teams;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

export function formatLimit(limit: number | 'unlimited'): string {
  return limit === 'unlimited' ? 'Unlimited' : String(limit);
}

const TIER_ORDER: PlanTier[] = PLAN_DEFINITIONS.map((p) => p.tier);

/** Whether `tier` is at or above `min` in the plan hierarchy (free < coach < coach_plus < club). */
export function isTierAtLeast(tier: PlanTier, min: PlanTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

/** The next tier up from `tier`, or null if already on the top tier. */
export function getNextTier(tier: PlanTier): PlanDefinition | null {
  const idx = PLAN_DEFINITIONS.findIndex((p) => p.tier === tier);
  if (idx === -1 || idx === PLAN_DEFINITIONS.length - 1) return null;
  return PLAN_DEFINITIONS[idx + 1];
}

/** Fraction (0-1) of a numeric/unlimited limit that `count` represents. 0 for unlimited limits. */
export function usageFraction(limit: number | 'unlimited', count: number): number {
  if (limit === 'unlimited' || limit <= 0) return 0;
  return count / limit;
}

/** Formats a plan's price for a given billing interval, e.g. "CAD$39.99" / "/yr". */
export function formatPlanPrice(
  plan: PlanDefinition,
  interval: BillingInterval
): { price: string; priceNote: string } {
  if (!plan.pricing) return { price: 'CAD$0', priceNote: 'forever' };
  const cents = plan.pricing[interval].amountCents;
  const dollars = cents / 100;
  const display = Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2);
  return { price: `CAD$${display}`, priceNote: interval === 'year' ? '/yr' : '/month' };
}
