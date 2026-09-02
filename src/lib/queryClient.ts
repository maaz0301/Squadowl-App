import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { isAuthExpiredError } from './authErrors';

/**
 * A dead session surfaces as a failed read or write like any other error, so
 * both caches funnel it here: tear the session down and flag it as expired,
 * which drops RootNavigator back to the auth stack and gets the user told why
 * rather than silently bounced.
 *
 * This used to test `error.message === 'Not authenticated'`, which only
 * userCtx() raises — and only when it has no cached user id. Once a screen has
 * loaded, the id is cached, so a revoked session reaches PostgREST instead and
 * comes back as PGRST301 / "JWT expired", which that check missed: the app sat
 * on error states until it was relaunched. isAuthExpiredError() matches on the
 * Auth API's error *code* first.
 */
function handleAuthError(error: unknown) {
  if (!isAuthExpiredError(error)) return;
  // require() rather than a static import: authStore imports queryClient (to
  // clear the cache on logout), so a top-level import here would be circular.
  try {
    const { useAuthStore } = require('../state/authStore');
    void useAuthStore.getState().expireSession();
  } catch (e) {
    console.error('Failed to sign out after an expired session:', e);
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  // Mutations had no auth handling at all: a session that died between opening
  // a screen and hitting Save left the user staring at a failed write with no
  // hint that signing in again was the fix.
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // Refetch stale queries when the app returns to the foreground — wired up
      // via AppState in App.tsx, since RN has no window-focus events of its own.
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export const queryKeys = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  teams: ['teams'] as const,
  teamManagers: (teamId?: string) =>
    teamId ? (['teamManagers', teamId] as const) : (['teamManagers'] as const),
  tryouts: (archived?: boolean) => ['tryouts', { archived }] as const,
  /**
   * The light list-screen read (listTryoutSummaries). Keyed as a *superset* of
   * `tryouts(archived)` on purpose: react-query matches object segments
   * partially, so every existing `invalidateQueries({ queryKey: tryouts(x) })`
   * refreshes the summaries too and no write path had to learn a second key.
   */
  tryoutSummaries: (archived?: boolean) => ['tryouts', { archived, view: 'summary' }] as const,
  assignedTryouts: ['tryouts', 'assigned'] as const,
  /** Same superset trick as tryoutSummaries, against `assignedTryouts`. */
  assignedTryoutSummaries: ['tryouts', 'assigned', { view: 'summary' }] as const,
  tryout: (id: string) => ['tryout', id] as const,
  /** listAssessmentAthletes — the flat (athlete, assessment) candidate list behind
   * a team's "Add Players from Assessments" picker. Deliberately its own key
   * rather than a slice of `tryouts`: it comes back shaped as AssessmentAthlete[]
   * rows, not Tryout[], so it can't share a cache entry with either. */
  assessmentAthletes: ['assessmentAthletes'] as const,
  registrations: (tryoutId: string) => ['registrations', tryoutId] as const,
  results: (tryoutId: string) => ['results', tryoutId] as const,
  seasons: ['seasons'] as const,
  season: (id: string) => ['season', id] as const,
  org: ['org'] as const,
  /**
   * `includeTeamManagers` is a suffix rather than a separate key so the plain
   * ['org', 'members'] prefix every org write invalidates still reaches it.
   */
  orgMembers: (userId?: string, includeTeamManagers?: boolean) =>
    userId
      ? includeTeamManagers
        ? (['org', 'members', userId, 'withTeamManagers'] as const)
        : (['org', 'members', userId] as const)
      : (['org', 'members'] as const),
  enterprisePayments: ['enterprise', 'payments'] as const,
  connectAccountStatus: ['connect', 'account-status'] as const,
  adminStats: ['admin', 'stats'] as const,
  adminUsers: ['admin', 'users'] as const,
  aiPlayer: (tryoutId: string, playerId: string) => ['ai', 'player', tryoutId, playerId] as const,
  teamBuilderResults: (tryoutId: string) => ['teamBuilderResults', tryoutId] as const,
  guardianRosters: (userId?: string) => userId ? ['guardian', 'rosters', userId] as const : ['guardian', 'rosters'] as const,
  playerProfile: (athleteId: string) => ['playerProfile', athleteId] as const,
  coachDirectory: ['coachDirectory'] as const,
  athleteShares: (athleteId: string) => ['athleteShares', athleteId] as const,
  sharedAthletes: ['sharedAthletes'] as const,
  athleteShare: (shareId: string) => ['athleteShare', shareId] as const,
  shareComments: (shareId: string) => ['shareComments', shareId] as const,
  teamMessages: (seasonId: string) => ['teamMessages', seasonId] as const,
  referralSummary: ['referral', 'summary'] as const,
};
