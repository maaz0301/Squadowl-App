/**
 * An account's access state, derived exactly the way the database's
 * `account_access_status()` does (20260916120000_founder_org_management.sql
 * in the web repo, which owns the schema both apps share), so the app can
 * explain a block that RLS is already enforcing.
 *
 * Nothing here is trusted: a member of a suspended account is cut off by the
 * RLS helpers whatever this returns. It only decides which screen they see.
 */
export type AccountAccessStatus = 'active' | 'trial' | 'suspended';

export interface AccountAccessFields {
  suspended_at?: string | null;
  trial_ends_at?: string | null;
  is_comp?: boolean | null;
  subscription_status?: string | null;
}

export function deriveAccountAccess(a: AccountAccessFields, now: number = Date.now()): AccountAccessStatus {
  if (a.suspended_at) return 'suspended';
  if (a.subscription_status === 'trialing') return 'trial';
  if (!a.trial_ends_at || a.is_comp) return 'active';
  if (a.subscription_status === 'active' || a.subscription_status === 'past_due') return 'active';
  return Date.parse(a.trial_ends_at) > now ? 'trial' : 'suspended';
}

/** A founder-granted trial that ran out — the one "suspended" nobody clicked. */
export function isExpiredTrial(a: AccountAccessFields, now: number = Date.now()): boolean {
  return !a.suspended_at && deriveAccountAccess(a, now) === 'suspended';
}
