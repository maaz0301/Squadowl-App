import { supabaseAdmin } from './supabaseAdmin.ts';

/**
 * Rank memberships the same way the app does (SupabaseDataSource.loadUserProfile
 * and ctx()): a staff role always beats a read-only one, and ties break on the
 * oldest membership.
 *
 * These functions used to take `order('created_at').limit(1)` — the *oldest*
 * membership, with no role filter. The app reads
 * accounts.stripe_connect_charges_enabled off the *highest-privilege* one, so
 * for any user with more than one membership the two resolved to different
 * accounts: onboarding wrote the Connect account and its enabled flags to one
 * row while the UI read the flag off another, leaving "Connect with Stripe"
 * showing forever. Worse, a user whose oldest membership is a guardian/assessor
 * seat in someone else's org would have had a Connect account created against
 * that org.
 */
const ROLE_RANK: Record<string, number> = {
  admin: 0,
  coach: 1,
  owner: 2,
  assessor: 3,
  guardian: 4,
};

export interface ResolvedMembership {
  accountId: string;
  role: string;
  account: Record<string, any> | null;
}

/**
 * `accountColumns` is the select list for the joined accounts row, e.g.
 * 'id, stripe_connect_account_id'.
 */
export async function resolvePrimaryMembership(
  userId: string,
  accountColumns: string,
): Promise<ResolvedMembership> {
  const { data, error } = await supabaseAdmin
    .from('memberships')
    .select(`account_id, role, accounts(${accountColumns})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) throw new Error('No account membership found for user');

  // Stable sort on rank only — the query already returns oldest-first, so equal
  // ranks keep that order.
  const best = rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        (ROLE_RANK[a.r.role] ?? 99) - (ROLE_RANK[b.r.role] ?? 99) || a.i - b.i,
    )[0].r;

  return {
    accountId: best.account_id,
    role: best.role,
    account: Array.isArray(best.accounts) ? (best.accounts[0] ?? null) : (best.accounts ?? null),
  };
}
