import { getSupabase } from '@/lib/supabase';
import {
  getPlanDefinition,
  getNextUsefulTier,
  getTeamAllowance,
  sellsExtraTeams,
  usageFraction,
  formatLimit,
  formatCad,
  type UsageLimitMetric,
} from '@/data/plans';
import type { PlanTier } from '@/data/types';

export const NUDGE_THRESHOLD = 0.85;

export type UsageMetric = UsageLimitMetric;

/** The limit in force for this metric — for teams that's the plan's included teams plus
 * any add-on team licenses the account has bought, not the bare plan number. */
export function effectiveLimit(
  tier: PlanTier,
  metric: UsageMetric,
  extraTeamLicenses = 0
): number | 'unlimited' {
  if (metric === 'teams') return getTeamAllowance(tier, extraTeamLicenses);
  return getPlanDefinition(tier).limits[metric];
}

/** Builds the "You're at X of Y ..." copy shared by the in-app banner and the push notification. */
export function buildNudgeMessage(
  tier: PlanTier,
  metric: UsageMetric,
  count: number,
  label: string,
  extraTeamLicenses = 0
): string {
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  const next = getNextUsefulTier(tier, metric);
  if (metric === 'teams' && sellsExtraTeams(tier)) {
    return `You're at ${count} of ${formatLimit(limit)} teams, add more for ${formatCad(
      getPlanDefinition(tier).extraTeamPriceCents!
    )} per team per year.`;
  }
  return next
    ? `You're at ${count} of ${formatLimit(limit)} ${label}, upgrade to ${next.name} for ${formatLimit(next.limits[metric])} ${label}.`
    : `You're at ${count} of ${formatLimit(limit)} ${label}.`;
}

/** Builds the hard-block "you can't create another one" copy for LimitReachedModal —
 * unlike buildNudgeMessage this always names the tier that actually raises the limit
 * (getNextUsefulTier), since the immediate next tier sometimes doesn't (Free and Coach
 * both cap teams at 1). On a tier that sells extra teams there is no tier to name: the
 * fix is buying another team license, so the copy points at that instead. */
export function buildLimitReachedMessage(
  tier: PlanTier,
  metric: UsageMetric,
  label: string,
  extraTeamLicenses = 0
): string {
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  if (metric === 'teams' && sellsExtraTeams(tier)) {
    return `You're using all ${formatLimit(limit)} of your teams. Add another team for ${formatCad(
      getPlanDefinition(tier).extraTeamPriceCents!
    )} per year from the plans screen.`;
  }
  const next = getNextUsefulTier(tier, metric);
  return next
    ? `You've reached your plan's limit of ${formatLimit(limit)} ${label}. Upgrade to ${next.name} for ${formatLimit(next.limits[metric])} ${label}.`
    : `You've reached your plan's limit of ${formatLimit(limit)} ${label}.`;
}

/** In-memory guard so we don't re-attempt the insert on every re-render within a session. */
const attempted = new Set<string>();

/**
 * Sends a single push notification the first time a user crosses 85% of a plan limit
 * for a given metric+tier. Idempotent across sessions/devices via the unique constraint
 * on usage_nudge_notifications(user_id, metric, plan_tier) — a 23505 conflict just means
 * another device or an earlier render already sent it.
 */
export async function maybeSendUsageNudgePush(
  userId: string,
  tier: PlanTier,
  metric: UsageMetric,
  count: number,
  label: string,
  extraTeamLicenses = 0
): Promise<void> {
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  const fraction = usageFraction(limit, count);
  const atLimit = limit !== 'unlimited' && count >= (limit as number);
  if (limit === 'unlimited' || fraction < NUDGE_THRESHOLD || atLimit) return;

  const cacheKey = `${userId}:${metric}:${tier}`;
  if (attempted.has(cacheKey)) return;
  attempted.add(cacheKey);

  const supabase = getSupabase();
  const { error } = await supabase
    .from('usage_nudge_notifications')
    .insert({ user_id: userId, metric, plan_tier: tier });

  if (error) {
    if (error.code !== '23505') attempted.delete(cacheKey);
    return;
  }

  const message = buildNudgeMessage(tier, metric, count, label, extraTeamLicenses);
  supabase.functions
    .invoke('send-push-notification', {
      body: { target_user_ids: [userId], heading: "You're approaching your plan limit", content: message },
    })
    .catch(console.error);
}
