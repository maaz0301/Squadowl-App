import { getDataSource } from '@/data';
import type { DataSource } from '@/data/datasource';
import { expandEventForms } from '@/lib/recurrence';
import type { DummyDataOptions, DummyTeamOptions } from '@/data/testDataGenerator';
import type { LetterKind } from '@/data/letters';
import {
  getPlayerRubrics,
  type RubricCategory
} from '@/data/rubrics';
import type {
  AddPlayerForm,
  CreateAssessmentForm,
  Registration,
  RegistrationSubmit,
  TeamRosterPlayer,
  ScoreForm,
  Team,
  TeamRosterCursor,
  Tryout,
  UserProfile,
  ChatReportReason,
} from '@/data/types';
import { queryKeys } from '@/lib/queryClient';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useChatReadStore } from '@/state/chatReadStore';
import { useSessionStore } from '@/state/sessionStore';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect } from 'react';

// ---- Auth ----
export function useProfileQuery() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => getDataSource().getProfile(),
  });
}

// ---- Teams ----
export function useTeamsQuery() {
  return useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => getDataSource().listTeams(),
  });
}

/** Teams a plan downgrade archived, for the restore screen. */
export function useArchivedTeamsQuery() {
  return useQuery({
    queryKey: queryKeys.archivedTeams,
    queryFn: () => getDataSource().listArchivedTeams(),
  });
}

export function useRestoreTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().restoreTeam(id),
    onSuccess: () => {
      // Prefix match: the active list and the archived list both hang off ['teams'].
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // The team's season comes back with it.
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useCreateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, season }: { name: string; season?: string }) =>
      withTimeout(getDataSource().createTeam(name, season), 15000),
    // Seeded synchronously so the team is already in the cache the instant
    // navigation lands on TeamDetail — that screen derives `team` from this
    // list with `.find()`, and without this the invalidate below is still a
    // network round trip away, so the screen found nothing and rendered
    // "Team not found." until the refetch came back.
    onSuccess: (team) => {
      qc.setQueryData<Team[]>(queryKeys.teams, (old) => (old ? [...old, team] : [team]));
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}


export function useUploadOrganizationLogoMutation() {
  return useMutation({
    mutationFn: async ({ fileUri, fileType }: { fileUri: string; fileType: string }) => {
      return getDataSource().uploadOrganizationLogo(fileUri, fileType);
    },
  });
}

export function useUploadTeamLogoMutation() {
  return useMutation({
    mutationFn: async ({ teamId, fileUri, fileType }: { teamId: string; fileUri: string; fileType: string }) => {
      return getDataSource().uploadTeamLogo(teamId, fileUri, fileType);
    },
  });
}

/**
 * A player's name, photo, birth year, position, guardian/contact info and
 * medical info all live on one canonical `athletes` row (see updatePlayer,
 * updateTeamRosterPlayer and uploadPlayerPhoto in SupabaseDataSource) — but
 * that same athlete can be showing on this team's roster, any *other* team's
 * roster, a season roster, any tryout roster the account has them on
 * (including ones nothing else in this session has open), the player profile
 * screen, the athlete history read and the cross-assessment "Add Players from
 * Evaluations" candidate list.
 *
 * Every write to that canonical row calls this instead of invalidating only
 * the one query for the screen the edit was made on, so an edit made from an
 * assessment shows up on the team roster (and vice versa) without whoever's
 * looking at it having to navigate away and back or pull to refresh.
 * `['tryout']`/`['tryouts']`/`['season']`/`['teams']` are prefixes, not full
 * keys — see tryoutSummaries above for the same trick: react-query matches a
 * query key by prefix, so invalidating the root reaches every id-specific
 * entry under it (every open tryout, tryout list/summary, season and team
 * roster) in one call.
 */
function invalidateAthleteEverywhere(qc: ReturnType<typeof useQueryClient>, athleteId?: string) {
  qc.invalidateQueries({ queryKey: ['tryout'] });
  qc.invalidateQueries({ queryKey: ['tryouts'] });
  qc.invalidateQueries({ queryKey: ['season'] });
  qc.invalidateQueries({ queryKey: queryKeys.teams });
  qc.invalidateQueries({ queryKey: queryKeys.assessmentAthletes });
  qc.invalidateQueries({ queryKey: ['athletes'] });
  if (athleteId) {
    qc.invalidateQueries({ queryKey: queryKeys.playerProfile(athleteId) });
    qc.invalidateQueries({ queryKey: ['athleteHistory', athleteId] });
  }
}

// ---- Team roster ----
const teamRosterKey = (teamId: string) => ['teams', teamId, 'roster'] as const;

type TeamRosterPage = { players: TeamRosterPlayer[]; nextCursor?: TeamRosterCursor };
/** The shapes cached under a team's roster prefix: the flat read, the paged
 * one, and the athlete-id list. */
type TeamRosterCache =
  | TeamRosterPlayer[]
  | InfiniteData<TeamRosterPage>
  | TeamRosterPlayer
  | string[]
  | null
  | undefined;

/** Removes athletes from whichever of those shapes a cache entry holds. The
 * prefix also covers the single-player entry (useTeamRosterPlayerQuery), which
 * has no `pages`; it is left alone here and dropped by the invalidate. */
function dropRosterPlayers(cache: TeamRosterCache, athleteIds: ReadonlySet<string>): TeamRosterCache {
  if (Array.isArray(cache)) {
    // Either the flat roster or the athlete-id list, depending on the entry.
    return (cache as unknown[]).filter((p) =>
      typeof p === 'string' ? !athleteIds.has(p) : !athleteIds.has((p as TeamRosterPlayer).athleteId),
    ) as TeamRosterCache;
  }
  if (!cache || !Array.isArray((cache as InfiniteData<TeamRosterPage>).pages)) return cache;
  return {
    ...(cache as InfiniteData<TeamRosterPage>),
    pages: (cache as InfiniteData<TeamRosterPage>).pages.map((page) => ({
      ...page,
      players: page.players.filter((p) => !athleteIds.has(p.athleteId)),
    })),
  };
}

function dropRosterPlayer(cache: TeamRosterCache, athleteId: string): TeamRosterCache {
  return dropRosterPlayers(cache, new Set([athleteId]));
}

/**
 * Every player on a team, in one array — rows and all.
 *
 * The expensive read: on a club-sized team it is several 200-row pages, each
 * paying can_access_athlete() per row through the `athletes` embed. Nothing on
 * the team screen needs it any more — the Players tab reads
 * useTeamRosterPagesQuery, membership and headcount come from
 * useTeamRosterAthleteIdsQuery, and the player card reads its own row — so
 * reach for it only where a caller genuinely needs every player's full record
 * at once, and pass `enabled` so it doesn't start until then.
 */
export function useTeamRosterQuery(teamId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: teamRosterKey(teamId ?? ''),
    queryFn: () => getDataSource().listTeamRoster(teamId!),
    enabled: !!teamId && enabled,
    // Same reasoning as useTryoutQuery's gcTime: a roster read is several
    // round trips plus a per-athlete fee lookup, so dropping the entry after
    // the 5-minute default means stepping out of a team and back in lands on a
    // blocking spinner instead of the list. Held long enough that the return
    // trip renders from cache and refetches quietly underneath.
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * A team's roster one page at a time — what the Players tab renders.
 *
 * Separate from useTeamRosterQuery so the list can paint off a single statement
 * instead of every player on the team (see listTeamRosterPage). The full read
 * is still what the flows that need everyone use: the "already on this team"
 * flags in the player picker, and the plan's per-team limit.
 *
 * `search` is part of the key and is matched server-side, so a search covers
 * the whole roster rather than only the pages already pulled down. Pass it
 * debounced — every distinct value is its own read.
 *
 * Keyed under the team's roster prefix, so the
 * `invalidateQueries({ queryKey: teamRosterKey(teamId) })` every roster write
 * already runs refreshes these pages too.
 */
export function useTeamRosterPagesQuery(teamId: string | undefined, search = '') {
  return useInfiniteQuery({
    queryKey: [...teamRosterKey(teamId ?? ''), 'pages', search.trim()] as const,
    queryFn: ({ pageParam }) =>
      getDataSource().listTeamRosterPage(teamId!, { after: pageParam, search }),
    initialPageParam: undefined as TeamRosterCursor | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!teamId,
    // Same reasoning as useTeamRosterQuery's gcTime: stepping out of a team and
    // back in should land on the list, not a spinner.
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * One player's team-roster row, for the player card.
 *
 * Keyed under the team's roster prefix so roster writes refresh it, but read on
 * its own: the card used to `.find()` the athlete in the full roster array,
 * which is a thousand rows to render one now that no screen loads that array
 * up front.
 */
export function useTeamRosterPlayerQuery(teamId: string | undefined, athleteId: string | undefined) {
  return useQuery({
    queryKey: [...teamRosterKey(teamId ?? ''), 'player', athleteId ?? ''] as const,
    queryFn: () => getDataSource().getTeamRosterPlayer(teamId!, athleteId!),
    enabled: !!teamId && !!athleteId,
  });
}

/**
 * The athlete ids on a team's roster — membership and headcount in one cheap
 * read.
 *
 * The tab badge, the plan's per-team limit and the "already on this team" flags
 * in the player picker all used to come from the full roster array, which is
 * what forced that read to happen on a screen that opens on the schedule. This
 * answers all three without pulling an athlete row per player.
 */
export function useTeamRosterAthleteIdsQuery(teamId: string | undefined) {
  return useQuery({
    queryKey: [...teamRosterKey(teamId ?? ''), 'athleteIds'] as const,
    queryFn: () => getDataSource().listTeamRosterAthleteIds(teamId!),
    enabled: !!teamId,
    gcTime: 30 * 60 * 1000,
  });
}

export function useAddTeamRosterPlayersMutation(
  teamId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[]) =>
      getDataSource().addTeamRosterPlayers(teamId, entries, onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      // The team_roster_season_enrollment trigger enrolled them on a season this
      // client may already have cached.
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

/**
 * Bulk-add players read out of a spreadsheet. `onProgress` is threaded through
 * rather than inferred from the mutation's pending flag: an import of thirty
 * players is slow enough that "working…" on its own reads as a hang.
 */
export function useImportTeamRosterPlayersMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      rows,
      onProgress,
    }: {
      rows: { line: number; form: AddPlayerForm }[];
      onProgress?: (done: number) => void;
    }) => getDataSource().importTeamRosterPlayers(teamId, rows, onProgress),
    // Invalidate whatever the outcome: a partial import still changed the roster.
    onSettled: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
  });
}

export function useAddManualTeamPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => getDataSource().addManualTeamPlayer(teamId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useUpdateTeamRosterPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, form }: { athleteId: string; form: AddPlayerForm }) =>
      getDataSource().updateTeamRosterPlayer(teamId, athleteId, form),
    onSuccess: (_data, { athleteId }) => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      invalidateAthleteEverywhere(qc, athleteId);
    },
  });
}

export function useUploadTeamPlayerPhotoMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, fileUri, fileType }: { athleteId: string; fileUri: string; fileType: string }) =>
      getDataSource().uploadPlayerPhoto(athleteId, fileUri, fileType),
    onSuccess: (_data, { athleteId }) => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      invalidateAthleteEverywhere(qc, athleteId);
    },
  });
}

export function useRemoveTeamRosterPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteId: string) => getDataSource().removeTeamRosterPlayer(teamId, athleteId),
    // The row leaves the list the moment the delete lands, instead of staying
    // on screen until a full roster refetch comes back — on a large roster
    // that refetch is seconds, and the player the coach just removed sat there
    // the whole time looking like the tap did nothing. The invalidate still
    // runs underneath and remains the source of truth; it just no longer gates
    // what the user sees.
    onSuccess: (_data, athleteId) => {
      // Every cache entry under the team's roster prefix, because the Players
      // tab reads the paged one (useTeamRosterPagesQuery) and the picker reads
      // the flat one — dropping the row from only one of them left the coach
      // watching the player they just removed sit there until the refetch.
      qc.setQueriesData<TeamRosterCache>({ queryKey: teamRosterKey(teamId) }, (old) =>
        dropRosterPlayer(old, athleteId),
      );
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
    },
  });
}

/**
 * Remove a set of players from a team roster in one go — the Players tab's
 * "select all, delete". Same optimistic drop as the single removal, applied to
 * every id at once so the list doesn't shed rows one refetch at a time.
 */
export function useRemoveTeamRosterPlayersMutation(teamId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (athleteIds: string[]) => getDataSource().removeTeamRosterPlayers(teamId, athleteIds, onProgress),
    onSuccess: (_data, athleteIds) => {
      const ids = new Set(athleteIds);
      qc.setQueriesData<TeamRosterCache>({ queryKey: teamRosterKey(teamId) }, (old) => dropRosterPlayers(old, ids));
    },
    // Whatever the outcome: a partial failure still changed the roster, and the
    // refetch is what shows which players are actually left.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

/**
 * Invite a team's roster to the portal — each player's own email and their
 * guardian's. No invalidation: nothing the team screen renders is derived from
 * portal_invites, and the caller reports the per-address outcome it returns.
 */
export function useTeamRosterInvitesMutation(teamId: string) {
  return useMutation({
    mutationFn: (athleteIds?: string[]) => getDataSource().sendTeamRosterInvites(teamId, athleteIds),
  });
}

export function useAcceptAssignmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tryoutId: string) => {
      const ds = getDataSource();
      return ds.acceptAssignedTryout(tryoutId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignedTryouts });
    },
  });
}

export function useRejectAssignmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tryoutId: string) => {
      const ds = getDataSource();
      return ds.rejectAssignedTryout(tryoutId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignedTryouts });
    },
  });
}

export function useCompleteAssignmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tryoutId: string) => getDataSource().completeAssignedTryout(tryoutId),
    onSuccess: (_data, tryoutId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assignedTryouts });
      queryClient.invalidateQueries({ queryKey: queryKeys.tryoutSummaries(false) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

// ---- Tryouts ----
/**
 * The **full** tryouts, rosters/evaluations/registrations and all. Only for
 * screens that genuinely read that data — search (it matches player names),
 * the roster library, combine, and the enterprise metrics. Anything drawing
 * list cards wants useTryoutSummariesQuery instead.
 */
export function useTryoutsQuery(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tryouts(includeArchived),
    queryFn: () => getDataSource().listTryouts(includeArchived),
    enabled,
  });
}

/**
 * The list screens' read — a name, a sport, a date and a headcount per card.
 *
 * See TryoutSummary. The key is a superset of `tryouts(includeArchived)`, so
 * every `invalidateQueries({ queryKey: queryKeys.tryouts(x) })` already in the
 * write paths refreshes this too — react-query matches object key segments
 * partially, so no mutation had to learn a second key.
 */
export function useTryoutSummariesQuery(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.tryoutSummaries(includeArchived),
    queryFn: () => getDataSource().listTryoutSummaries(includeArchived),
  });
}

/**
 * The flat (athlete, assessment) candidate list behind a team's "Add Players
 * from Assessments" picker — see AssessmentAthlete. Enabled on demand since
 * the picker's modal is the only consumer and needn't be paid for otherwise.
 */
export function useAssessmentAthletesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.assessmentAthletes,
    queryFn: () => getDataSource().listAssessmentAthletes(),
    enabled,
  });
}

/**
 * Global search's player pool: names and jerseys only, no scores. Keyed under
 * `tryouts` so every roster write that already refreshes the evaluations
 * refreshes this too. Long staleTime because it is a search corpus, not a
 * live view, and a fresh keystroke should never wait on it.
 */
export function useSearchPlayersQuery() {
  return useQuery({
    queryKey: [...queryKeys.tryouts(false), 'search-players'] as const,
    queryFn: () => getDataSource().listSearchPlayers(),
    staleTime: 5 * 60_000,
  });
}

export function useAssignedTryoutsQuery() {
  return useQuery({
    queryKey: queryKeys.assignedTryouts,
    queryFn: () => getDataSource().listAssignedTryouts(),
  });
}

/** Light counterpart of useAssignedTryoutsQuery — see useTryoutSummariesQuery. */
export function useAssignedTryoutSummariesQuery() {
  return useQuery({
    queryKey: queryKeys.assignedTryoutSummaries,
    queryFn: () => getDataSource().listAssignedTryoutSummaries(),
  });
}

/**
 * Key + fetcher for one tryout, shared by `useTryoutQuery` and
 * `usePrefetchTryout` so a warmed entry always lands on exactly the key the
 * screens read back.
 */
function tryoutQueryOptions(id: string) {
  return {
    queryKey: queryKeys.tryout(id),
    queryFn: () => getDataSource().getTryout(id),
  };
}

export function useTryoutQuery(id: string | undefined) {
  return useQuery({
    ...tryoutQueryOptions(id ?? ''),
    enabled: !!id,
    // Assembling a tryout pulls its whole roster plus every evaluation, so a
    // dropped cache entry costs a multi-second refetch behind a blocking
    // "Loading roster..." on the next visit. Held well past the 5-minute
    // default so stepping out of an assessment and back in renders instantly
    // from cache, with the refetch happening quietly behind the visible list.
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Start loading a tryout before its screens mount. Called the moment the user
 * taps into an assessment so the fetch overlaps the navigation animation
 * rather than starting once the roster is already on screen — on a large
 * roster that's the difference between landing on data and landing on a
 * spinner. No-ops when the cache is already fresh.
 */
export function usePrefetchTryout() {
  const qc = useQueryClient();
  return (id: string | undefined) => {
    if (!id) return;
    qc.prefetchQuery({ ...tryoutQueryOptions(id), staleTime: 30_000 });
  };
}

export function useTryoutRealtimeSync(id: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;

    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(id) });
      }, 1000);
    };

    // Subscribe to insert/update events on the evaluations table for this specific tryout.
    // evaluation_scores is deliberately NOT subscribed: it has no tryout_id, so a
    // filter isn't possible and an unfiltered channel wakes every open tryout on
    // every score saved anywhere (and Realtime re-checks RLS per subscriber per
    // row). saveEvaluation touches the evaluation row after its scores land, which
    // fires this filtered event instead.
    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:tryout_${id}_${uniqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluations', filter: `tryout_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [id, qc]);
}

// ---- Seasons realtime (keeps a coach's Team/Season screens and a guardian's
// portal in sync — RSVPs and event edits made on one device show up on the
// other without navigating away and back) ----
export function useSeasonRealtimeSync(id: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!id) return;

    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.season(id) });
        // A guardian viewing the same season (e.g. via a shared device) sees it too.
        qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
      }, 1000);
    };

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:season_${id}_${uniqueId}`)
      .on(
        // A coach deleting the season itself — the case this was missing.
        // Without it a guardian's cached roster/season data only went stale
        // whenever something else happened to touch season_events/
        // event_availability on a season they still (per the cache) belonged to.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seasons', filter: `id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        // Enrollment — including the rows the team_roster_season_enrollment
        // trigger writes when a coach adds a player to the team, which is not a
        // write to this season anyone on this screen made.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'season_roster', filter: `season_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'season_events', filter: `season_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        // event_availability has no season_id column of its own (it keys off
        // season_event_id + roster_id), so this can't be filtered server-side.
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_availability' },
        () => triggerInvalidate()
      )
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [id, qc]);
}

// A guardian's portal spans every season/tryout their linked athletes are on,
// not a single season id, so this subscribes broadly rather than per-season.
export function useGuardianRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    const triggerInvalidate = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
      }, 1000);
    };

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:guardian_${uniqueId}`)
      // No season_id filter possible here — a guardian's portal spans every
      // season across every linked athlete, not one id — so this catches a
      // coach deleting ANY season, not just the one currently on screen.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seasons' }, () => triggerInvalidate())
      // Enrollment itself — a coach adding the athlete to a team (which enrolls
      // them on its season via the team_roster_season_enrollment trigger) is what
      // flips this portal from "isn't assigned to any tryouts or seasons yet" to a
      // live schedule and chat, and nothing else here fires on it. Without this the
      // guardian sat on the empty state until they reopened the portal.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'season_roster' }, () => triggerInvalidate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'season_events' }, () => triggerInvalidate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_availability' }, () => triggerInvalidate())
      .subscribe();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      getSupabase().removeChannel(channel);
    };
  }, [qc]);
}

export function useCreateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    // Longer than the usual 15s: a team-linked create imports and re-reads the
    // whole team roster, and giving up early doesn't cancel the server-side
    // create — it just told the coach "network error" and invited a retry that
    // made a duplicate evaluation.
    mutationFn: (form: CreateAssessmentForm) => {
      const pending = getDataSource().createTryout(form);
      return new Promise<Tryout>((resolve, reject) => {
        const timer = setTimeout(() => {
          // Hand the still-running create back to the screen instead of a
          // "network" error, and refresh the caches whenever it does land.
          pending.then(seed).catch(() => {});
          reject(new CreateTryoutContinuingError(pending));
        }, form.teamId ? 90000 : 15000);
        pending.then(
          (t) => { clearTimeout(timer); resolve(t); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
    },
    onSuccess: (tryout) => seed(tryout),
  });

  function seed(tryout: Tryout) {
    // Seed the single-tryout cache with what the create call already
    // returned — without this, navigating straight to the new assessment's
    // settings screen lands useTryoutQuery on an empty cache, which refetches
    // the whole roster+evaluations bundle behind a blocking spinner instead
    // of rendering immediately.
    qc.setQueryData(queryKeys.tryout(tryout.id), tryout);
    qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
    qc.invalidateQueries({ queryKey: queryKeys.profile });
  }
}

/**
 * Thrown when creating an evaluation outlasts the client timeout. The create
 * isn't cancelled — `pending` still resolves with the finished evaluation (and
 * its imported team players) — so the screen can tell the coach it's being
 * finished in the background rather than reporting a failure they'd retry,
 * which used to produce a duplicate evaluation.
 */
export class CreateTryoutContinuingError extends Error {
  constructor(readonly pending: Promise<Tryout>) {
    super('The evaluation is still being created in the background.');
    this.name = 'CreateTryoutContinuingError';
  }
}

export function useUpdateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Tryout> }) =>
      withTimeout(getDataSource().updateTryout(id, updates), 15000),
    onSuccess: (_tryout, { id, updates }) => {
      // updateTryout()'s return value carries empty roster/evals/registrations
      // (see SupabaseDataSource.updateTryout) to avoid re-paying the full
      // roster+evaluations assembly on every small edit, so it can't be used to
      // replace the cache directly. Merging just the changed fields into the
      // existing cache entry — the same move useCreateTryoutMutation makes —
      // gets the UI (e.g. FriendPackagesCard) updated instantly instead of
      // invalidating and forcing that multi-second refetch behind a spinner.
      qc.setQueryData(queryKeys.tryout(id), (current: Tryout | undefined) =>
        current ? { ...current, ...updates } : current,
      );
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
    },
  });
}

export function useArchiveTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().archiveTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

export function useDeleteTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
    },
  });
}

// ---- Utility ----
const withTimeout = <T>(promise: Promise<T>, ms: number = 15000, msg: string = 'Request timed out. Please check your network connection.'): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);
};

// ---- Players ----
export function useAddPlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => withTimeout(getDataSource().addPlayer(tryoutId, form), 15000, 'Adding player timed out. Please check your connection.'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      // The evaluation cards on the dashboard show this headcount.
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/**
 * Invite tryout participants to the portal on every address each has on file —
 * the assessment-roster twin of useSeasonRosterInvitesMutation /
 * useTeamRosterInvitesMutation. `participantIds` narrows to specific roster
 * rows, `emails` to specific addresses; omit both to invite the whole tryout
 * roster.
 */
export function useTryoutRosterInvitesMutation(tryoutId: string) {
  return useMutation({
    mutationFn: ({ participantIds, emails }: { participantIds?: string[]; emails?: string[] } = {}) =>
      getDataSource().sendTryoutRosterInvites(tryoutId, participantIds, emails),
  });
}

/** The assessment-roster counterpart of useImportTeamRosterPlayersMutation. */
export function useImportTryoutPlayersMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      rows,
      onProgress,
    }: {
      rows: { line: number; form: AddPlayerForm }[];
      onProgress?: (done: number) => void;
    }) => getDataSource().importTryoutPlayers(tryoutId, rows, onProgress),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdatePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, updates }: { playerId: string; updates: Partial<import('@/data/types').Player> }) =>
      withTimeout(getDataSource().updatePlayer(tryoutId, playerId, updates), 15000),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      invalidateAthleteEverywhere(qc, data.athleteId);
    },
  });
}

export function useDeletePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => getDataSource().deletePlayer(tryoutId, playerId),
    onSuccess: (_data, playerId) => {
      // Drop the player from the cached roster right away — see
      // useRemoveTeamRosterPlayerMutation. Their evaluations go with them so a
      // stale eval can't resurrect a row through evalCountByPlayerId.
      qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (old) =>
        old
          ? {
              ...old,
              roster: old.roster.filter((p) => p.id !== playerId),
              evals: old.evals.filter((e) => e.playerId !== playerId),
            }
          : old,
      );
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      // The evaluation cards on the dashboard show this headcount.
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      // The deleted player may have come from an accepted athlete share, which
      // deletePlayer flips to 'released' as a side effect — refresh that list too.
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
      // Their guardian is dropped with them once they are off every roster, so
      // the member directory that derives guardians from athletes is now stale.
      qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

/**
 * Delete several players from an assessment roster in one mutation. The
 * per-player mutation invalidates four queries on every success; run over a
 * whole roster that is hundreds of refetches, so this drops the rows from the
 * cache once and invalidates once.
 */
export function useDeletePlayersMutation(tryoutId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerIds: string[]) => getDataSource().deletePlayers(tryoutId, playerIds, onProgress),
    onSettled: (result) => {
      const gone = new Set(result?.deleted ?? []);
      if (gone.size > 0) {
        qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (old) =>
          old
            ? {
                ...old,
                roster: old.roster.filter((p) => !gone.has(p.id)),
                evals: old.evals.filter((e) => !gone.has(e.playerId)),
              }
            : old,
        );
      }
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: ['tryouts'] });
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
      qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

// ---- Evaluations ----
export function useSaveEvaluationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      playerId,
      form,
      evalId,
    }: {
      playerId: string;
      form: ScoreForm;
      evalId?: string;
    }) => {
      const activeAssessor = useSessionStore.getState().activeAssessor;
      return withTimeout(
        getDataSource().saveEvaluation(tryoutId, playerId, form, evalId, activeAssessor),
        15000,
        'Saving evaluation timed out. Please check your connection.'
      );
    },
    onSuccess: (newEval) => {
      qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (oldData) => {
        if (!oldData) return oldData;
        const evals = [...oldData.evals];
        const idx = evals.findIndex((e) => e.id === newEval.id);
        if (idx >= 0) {
          evals[idx] = newEval;
        } else {
          evals.push(newEval);
        }
        return { ...oldData, evals };
      });
      // Mark related queries as stale but don't block onSubmit with immediate refetches.
      // They will re-fetch in the background when their components are next focused.
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId), refetchType: 'none' });
      qc.invalidateQueries({ queryKey: queryKeys.profile, refetchType: 'none' });
      // The player card's history and season-over-season read this; without it the card shows "not scored" until reloaded.
      qc.invalidateQueries({ queryKey: ['athleteHistory'] });
      qc.invalidateQueries({ queryKey: ['playerProfile'] });
      qc.invalidateQueries({ queryKey: ['sessionProgress', tryoutId] });
    },
  });
}

// ---- Registration ----
/**
 * The full registrations list. Polls every 20s so a coach watching a QR link
 * sees sign-ups arrive; pass `poll: false` while the screen isn't in view
 * (tab navigators keep unfocused screens mounted, and they'd keep re-downloading
 * every registration for a list nobody is looking at).
 */
export function useRegistrationsQuery(tryoutId: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: queryKeys.registrations(tryoutId),
    queryFn: () => getDataSource().listRegistrations(tryoutId),
    enabled: !!tryoutId,
    refetchInterval: options?.poll === false ? false : 20_000,
  });
}

/**
 * Pending-registration count for the tab badge. The badge used to be derived
 * from useRegistrationsQuery, which re-downloaded every registration row every
 * 20s on every assessment screen just to count a few. The key sits under
 * queryKeys.registrations(tryoutId), so every registration mutation that
 * invalidates that prefix refreshes this too.
 */
export function usePendingRegistrationCountQuery(tryoutId: string) {
  return useQuery({
    queryKey: [...queryKeys.registrations(tryoutId), 'pending-count'] as const,
    queryFn: () => getDataSource().countPendingRegistrations(tryoutId),
    enabled: !!tryoutId,
    refetchInterval: 60_000,
  });
}

export function useEnsureCloudSessionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tryoutId: string) => getDataSource().ensureCloudSession(tryoutId),
    onSuccess: (tryout) => {
      qc.setQueryData(queryKeys.tryout(tryout.id), tryout);
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryout.id) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
    },
  });
}

export function useSubmitRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: RegistrationSubmit) => getDataSource().submitRegistration(tryoutId, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) }),
  });
}

/**
 * `tryoutId` is the assessment the registration belongs to. Pass `targetTryoutId`
 * in the variables to roster the athlete onto a *different* assessment — both
 * assessments are then invalidated, since one gains a player and the other has a
 * registration flip to "added".
 */
export function useAddRegistrationToRosterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      registrationId,
      targetTryoutId,
    }: {
      registrationId: string;
      targetTryoutId?: string;
    }) => getDataSource().addRegistrationToRoster(targetTryoutId ?? tryoutId, registrationId),
    onSuccess: (_data, { targetTryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      if (targetTryoutId && targetTryoutId !== tryoutId) {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(targetTryoutId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/**
 * "Team" destination for a registration. `tryoutId` is only the assessment the
 * registration lives on — it's what gets invalidated so the row flips to
 * "added"; the athlete itself lands on `teamId`'s roster.
 */
export function useAddRegistrationToTeamMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, registrationId }: { teamId: string; registrationId: string }) =>
      getDataSource().addRegistrationToTeam(teamId, registrationId),
    onSuccess: (_data, { teamId }) => {
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

/**
 * Bulk placement for a multi-select. One mutation for the whole selection —
 * unlike firing the single-registration mutation per player, this invalidates
 * once at the end instead of once per player, so a large batch doesn't kick off
 * a refetch storm while it's still running.
 */
/**
 * Shared key for the long-running writes that add players to a tryout. These
 * can run for minutes and are started from whichever screen opened the
 * dialog, so any *other* screen showing that tryout can call `useIsMutating`
 * with this key to tell "this roster is genuinely empty" apart from "players
 * are still being written into it right now".
 */
export const tryoutBulkWriteKey = (tryoutId: string) => ['tryoutBulkWrite', tryoutId] as const;

export function usePlaceRegistrationsMutation(
  tryoutId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    // Keyed on the source assessment — the roster being filled is usually this
    // one, and a placement into some other destination is short enough that it
    // doesn't need the same treatment.
    mutationKey: tryoutBulkWriteKey(tryoutId),
    mutationFn: ({
      destination,
      registrationIds,
    }: {
      destination: { kind: 'assessment' | 'team'; id: string };
      registrationIds: string[];
    }) =>
      destination.kind === 'team'
        ? getDataSource().addRegistrationsToTeam(destination.id, registrationIds, onProgress)
        : getDataSource().addRegistrationsToRoster(destination.id, registrationIds, onProgress),
    onSuccess: (_count, { destination }) => {
      if (destination.kind === 'team') {
        qc.invalidateQueries({ queryKey: teamRosterKey(destination.id) });
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(destination.id) });
        if (destination.id !== tryoutId) {
          qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
        }
      }
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      // The dashboard's per-assessment player count lives on the tryout *list*
      // key, not the detail one — without this it keeps showing the old count
      // until it happens to go stale on its own.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useDismissRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      getDataSource().dismissRegistration(tryoutId, registrationId),
    // Same reasoning as useRemoveTeamRosterPlayerMutation: flip the row's
    // status in place so it leaves the Pending tab immediately. Dismissing is
    // a status change rather than a delete, so the row is rewritten, not
    // dropped — it still has to show up under All and Dismissed.
    onSuccess: (_data, registrationId) => {
      qc.setQueryData<Registration[] | undefined>(queryKeys.registrations(tryoutId), (old) =>
        old?.map((r) => (r.id === registrationId ? { ...r, status: 'dismissed' as const } : r)),
      );
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
    },
  });
}

// ---- Team registration link ----
/** Registrations made through a team's link are cached under their own key, apart from any evaluation's. */
const teamRegistrationsKey = (teamId: string) => queryKeys.registrations(`team:${teamId}`);

/** A team's registrations. Refreshes every 30s while the screen is focused so sign-ups arrive without a reload. */
export function useTeamRegistrationsQuery(teamId: string | undefined, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: teamRegistrationsKey(teamId ?? ''),
    queryFn: () => getDataSource().listTeamRegistrations(teamId!),
    enabled: !!teamId,
    refetchInterval: options?.poll === false ? false : 30_000,
  });
}

/** Pending-registration count for the Team Hub button: a head-only count, no rows. */
export function usePendingTeamRegistrationCountQuery(teamId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...teamRegistrationsKey(teamId ?? ''), 'pending-count'] as const,
    queryFn: () => getDataSource().countPendingTeamRegistrations(teamId!),
    enabled: !!teamId && enabled,
    refetchInterval: 60_000,
  });
}

export function useEnsureTeamRegistrationLinkMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => getDataSource().ensureTeamRegistrationLink(teamId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

export function useSetTeamRegistrationOpenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, open }: { teamId: string; open: boolean }) =>
      getDataSource().setTeamRegistrationOpen(teamId, open),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

export function useAddTeamRegistrationsMutation(teamId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    // One player goes straight through the single placement; the chunked bulk
    // path is for a ticked group and is much slower for a single registration.
    mutationFn: async (registrationIds: string[]) => {
      if (registrationIds.length === 1) {
        await getDataSource().addRegistrationToTeam(teamId, registrationIds[0]);
        return 1;
      }
      return getDataSource().addRegistrationsToTeam(teamId, registrationIds, onProgress);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
      void qc.invalidateQueries({ queryKey: teamRegistrationsKey(teamId) });
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useDismissTeamRegistrationMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) => getDataSource().dismissRegistration('', registrationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamRegistrationsKey(teamId) });
    },
  });
}

export function useGenerateTestDataMutation(tryoutId: string, onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: tryoutBulkWriteKey(tryoutId),
    mutationFn: (options: DummyDataOptions) => getDataSource().generateTestData(tryoutId, options, onProgress),
    // Same reasoning as useGenerateDummyTeamsMutation: this writes
    // incrementally, so a failure mid-batch still leaves real rows behind and
    // the refetch has to happen either way.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useClearTestDataMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getDataSource().clearTestData(tryoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useGenerateDummyTeamsMutation(onProgress?: (done: number, total: number) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: DummyTeamOptions) => getDataSource().generateDummyTeams(options, onProgress),
    // onSettled, not onSuccess: generateDummyTeams creates its teams one at a
    // time, so a failure partway through still leaves real teams and
    // assessments behind. Refetching only on success left those rows invisible
    // until the user manually reloaded the screen.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Prefix match — invalidates every archived/unarchived tryout list.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useClearDummyTeamsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getDataSource().clearDummyTeams(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

import { computeAssessorProgress, computePlayerResults } from '@/data/scoring';

export { computeAssessorProgress, computePlayerResults } from '@/data/scoring';

export function useResultsQuery(tryoutId: string | undefined) {
  const tryoutQuery = useTryoutQuery(tryoutId);
  return {
    ...tryoutQuery,
    results: tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : [],
    assessorProgress: tryoutQuery.data ? computeAssessorProgress(tryoutQuery.data) : [],
    rubrics: tryoutQuery.data
      ? getPlayerRubrics(
        tryoutQuery.data.sport,
        undefined,
        tryoutQuery.data.settings.customRubrics,
      )
      : ([] as RubricCategory[]),
  };
}

export function useUpdateProfileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<UserProfile>) => useAuthStore.getState().updateProfile(updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profile }),
  });
}

export function useUploadCoachPhotoMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, fileUri, fileType }: { userId: string; fileUri: string; fileType: string }) => {
      const publicUrl = await getDataSource().uploadCoachPhoto(userId, fileUri, fileType);
      const currentProfile = useAuthStore.getState().session?.user;
      if (currentProfile) {
        await useAuthStore.getState().updateProfile({ ...currentProfile, avatarUrl: publicUrl });
      }
      return publicUrl;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profile }),
  });
}

export function useUpdatePasswordMutation() {
  return useMutation({
    mutationFn: (password: string) => getDataSource().updatePassword(password),
  });
}

// ---- Phase 2: Team Builder, AI, Export ----
export function useGenerateTeamBuilderMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: import('@/data/teamBuilder').TeamBuilderConfig) => {
      // Claude has to enumerate every roster player in its response, so generation
      // time scales with roster size — a flat 60s cap only ever worked up to
      // roughly 100 players. Scale the client-side timeout with roster size instead,
      // capped at 5 minutes (large rosters can legitimately take that long to stream).
      const rosterSize = qc.getQueryData<Tryout>(queryKeys.tryout(tryoutId))?.roster.length ?? 0;
      const timeoutMs = Math.min(300000, Math.max(60000, 20000 + rosterSize * 300));
      return withTimeout(
        getDataSource().generateTeamBuilder(tryoutId, config),
        timeoutMs,
        'Team builder generation timed out. Claude AI might be taking longer than usual, please try again.'
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
  });
}

export function useTeamBuilderResultsQuery(tryoutId?: string) {
  return useQuery({
    queryKey: queryKeys.teamBuilderResults(tryoutId ?? ''),
    queryFn: () => getDataSource().listTeamBuilderResults(tryoutId!),
    enabled: !!tryoutId,
  });
}

export function useSaveTeamBuilderResultMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ label, state }: { label: string; state: import('@/data/teamBuilder').TeamBuilderState }) =>
      getDataSource().saveTeamBuilderResult(tryoutId, label, state),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) }),
  });
}

export function useDeleteTeamBuilderResultMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeamBuilderResult(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamBuilderResults(tryoutId) }),
  });
}

export function useAiPlayerSummaryMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => 
      withTimeout(
      getDataSource().getAiPlayerSummary(tryoutId, playerId),
          90000,
          'Generation is taking longer than expected.'
      ),
    onSuccess: (summary, playerId) => {
      // Write the AI result directly into the cached tryout so the UI updates
      // immediately — even if the DB save failed (e.g. RLS blocks the update for
      // assessor-role users). Without this, invalidateQueries would refetch from
      // DB which has no ai_assessments, and the summary would never appear.
      qc.setQueryData<Tryout | undefined>(queryKeys.tryout(tryoutId), (old) => {
        if (!old) return old;
        return {
          ...old,
          aiAssessments: {
            ...(old.aiAssessments ?? {}),
            [playerId]: summary,
          },
        };
      });
      // Also invalidate so owners/admins (who can write to DB) see the persisted result.
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useUploadPlayerPhotoMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, fileUri, fileType }: { athleteId: string; fileUri: string; fileType: string }) =>
      withTimeout(getDataSource().uploadPlayerPhoto(athleteId, fileUri, fileType), 15000, 'Uploading photo timed out. Please check your connection.'),
    onSuccess: (_data, { athleteId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      invalidateAthleteEverywhere(qc, athleteId);
    },
  });
}

export function useAiCompareMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (playerIds: string[]) => getDataSource().getAiCompare(tryoutId, playerIds),
  });
}

export function useExportTryoutMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (format: import('@/data/types').ExportFormat) =>
      getDataSource().exportTryout(tryoutId, format),
  });
}

export function useShareLinkMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (label?: string) => getDataSource().createShareLink(tryoutId, label),
  });
}

// ---- Phase 3: Seasons ----
/**
 * Which season belongs to which team, and how many events each has — without
 * assembling every season in the account. Use useSeasonsQuery only where a
 * screen genuinely works with a full season (schedule, roster, RSVPs).
 */
export function useSeasonSummariesQuery() {
  return useQuery({
    queryKey: queryKeys.seasonSummaries,
    queryFn: () => getDataSource().listSeasonSummaries(),
  });
}

export function useSeasonsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.seasons,
    queryFn: () => getDataSource().listSeasons(),
    enabled: options?.enabled ?? true,
  });
}

/**
 * A season, published to the cache in stages.
 *
 * getSeason() calls back with the events as soon as they land, then again with
 * the roster, and resolves last with the RSVPs and portal invites attached.
 * Writing that first pass into this query's own cache entry flips it out of
 * `isLoading` immediately, so the schedule draws off real data while the slow
 * half is still in flight, instead of holding a spinner for the whole read —
 * which on a 1000-player roster is seconds of roster and RSVP paging before an
 * event the coach could have seen from the first round trip.
 *
 * Only seeded when the entry is empty. On a background refetch there is
 * already a complete season cached, and overwriting it with a partial would
 * blank out a roster and RSVPs that are on screen and correct.
 */
export function useSeasonQuery(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.season(id ?? ''),
    queryFn: () => {
      const key = queryKeys.season(id!);
      // Captured before the read starts, not re-checked per callback: on a
      // background refetch there is already a complete season on screen, and
      // publishing a partial over it would blank out a roster and RSVPs that
      // are correct. On a cold read every stage is an improvement on the last.
      const seedable = !qc.getQueryData(key);
      return getDataSource().getSeason(id!, (partial) => {
        if (seedable) qc.setQueryData(key, partial);
      });
    },
    enabled: !!id,
  });
}

/**
 * The Season Roster screen's list, one page at a time.
 *
 * Separate from useSeasonQuery so the list can paint off a single statement
 * instead of the whole enrolled roster — see listSeasonRosterPage. The season
 * query is still what the rest of that screen reads (team, branding, the
 * import button), and it now arrives with its events long before the full
 * roster lands.
 *
 * Pages are keyed under the season's own key, so the existing
 * `invalidateQueries({ queryKey: queryKeys.season(id) })` in every roster write
 * refreshes them without changes.
 */
export function useSeasonRosterPagesQuery(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.seasonRosterPages(id ?? ''),
    queryFn: ({ pageParam }) => getDataSource().listSeasonRosterPage(id!, { after: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!id,
  });
}

export function useCreateSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateSeasonForm) => withTimeout(getDataSource().createSeason(form), 15000),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seasons }),
  });
}

export function useUpdateSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<import('@/data/types').Season> }) =>
      getDataSource().updateSeason(id, updates),
    onSuccess: (season) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(season.id) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useDeleteSeasonMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteSeason(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seasons }),
  });
}

/**
 * Splices a just-saved event into the cached season so the schedule shows it
 * the moment the save returns.
 *
 * Invalidating alone was not enough: getSeason() re-reads the whole season —
 * every event, the full roster, and every RSVP row on every event — so on a
 * 1000-player team the coach sat looking at a schedule *without* the event they
 * had just created until that refetch landed. The event row here is what the
 * server actually returned, and its invites were all just written as 'pending',
 * so this is the real state, not a guess. The invalidation still runs
 * afterwards to pick up anything else that moved; it's now a background
 * refresh rather than the thing standing between the coach and their event.
 *
 * Keyed by roster id AND athlete id, and sorted by date, to match exactly what
 * assembleSeasons() produces — otherwise the row would visibly rearrange when
 * the refetch replaced it.
 *
 * `invitedRoster` is the actual roster rows invited, not just their ids: a
 * team event can sync brand-new season-roster rows into existence in the same
 * call (see useAddTeamEventMutation), and those rows aren't in the cached
 * `prev.roster` yet. Building availability by matching ids against the stale
 * cache silently dropped every one of them — the event saved and invited them
 * correctly server-side, but showed "nobody invited" until the background
 * refetch below caught up. Merging `invitedRoster` into the cached roster too
 * means both the invite map and the name lookup that renders it are correct
 * immediately.
 */
function addEventToSeasonCache(
  qc: ReturnType<typeof useQueryClient>,
  seasonId: string,
  event: import('@/data/types').SeasonEvent,
  invitedRoster: import('@/data/types').SeasonPlayer[],
) {
  qc.setQueryData<import('@/data/types').Season>(queryKeys.season(seasonId), (prev) => {
    if (!prev) return prev;
    if (prev.events.some((e) => e.id === event.id)) return prev;
    const availability: Record<string, 'pending'> = {};
    for (const p of invitedRoster) {
      availability[p.id] = 'pending';
      if (p.athleteId) availability[p.athleteId] = 'pending';
    }
    const existingIds = new Set(prev.roster.map((p) => p.id));
    const roster = [...prev.roster, ...invitedRoster.filter((p) => !existingIds.has(p.id))];
    const events = [...prev.events, { ...event, availability }].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    return { ...prev, roster, events };
  });
}

export function useAddSeasonEventMutation(
  seasonId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: import('@/data/types').CreateEventForm) => {
      // A repeating event becomes several, saved together and announced once.
      const forms = expandEventForms(form);
      const events =
        forms.length > 1
          ? await getDataSource().addSeasonEvents(seasonId, forms, onProgress)
          : [await getDataSource().addSeasonEvent(seasonId, forms[0], onProgress)];
      return { event: events[0], events };
    },
    onSuccess: ({ events }, form) => {
      const cached = qc.getQueryData<import('@/data/types').Season>(queryKeys.season(seasonId));
      const roster = cached?.roster ?? [];
      const invitedRoster = form.playerIds?.length
        ? roster.filter((p) => form.playerIds!.includes(p.id))
        : roster;
      for (const event of events) addEventToSeasonCache(qc, seasonId, event, invitedRoster);
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

/**
 * Copies any team-roster player missing from the season roster across, then
 * returns the season roster plus the team's own roster. Availability (and
 * therefore guardian portal visibility) is keyed on season roster entries,
 * so this is what makes a team player actually receive events.
 *
 * Also back-fills from every assessment linked to the team, so a season
 * roster still enrolls athletes who only exist on an attached assessment
 * (attaching an assessment to a team is what puts its players on the team as
 * far as the schedule is concerned, without anyone having to re-import them
 * through Players → "Add Players from Assessments" first). But callers that
 * need "who should an event actually invite" must intersect the returned
 * `roster` against `teamRoster` — every assessment ever attached to the team
 * stays on the season roster forever (nothing prunes it when an assessment
 * is detached, or when the same dummy data gets regenerated), so the season
 * roster alone can balloon far past the team's real headcount.
 */
async function syncSeasonRosterFromTeam(
  teamId: string,
  seasonId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const ds = getDataSource();
  // Back-fill from every assessment linked to the team first. createSeason()
  // seeds the season roster from linked tryouts, but only at the moment the
  // season is created — attaching an assessment to a team afterwards adds
  // nobody, and nothing else ever back-fills. A team whose players only exist
  // on an assessment attached after its season already existed therefore had
  // an empty season roster, so every event it saved invited nobody at all and
  // the RSVP list read "Nobody was invited to this event yet." This is a no-op
  // once those athletes are enrolled.
  // Best-effort: this now sits on the critical path of every event save, and
  // it can throw (a season with no team linked, a transient read). Saving the
  // event with whoever is already enrolled beats failing the save outright.
  const existing = await ds
    .importSeasonPlayersFromTeam(seasonId, onProgress)
    .catch(async (e) => {
      console.warn('Could not back-fill the season roster from linked assessments', e);
      return ds.listSeasonRoster(seasonId);
    });

  const teamRoster = await ds.listTeamRoster(teamId);
  const alreadyOnSeason = new Set(existing.map((p) => p.athleteId).filter(Boolean));
  const missing = teamRoster.filter((p) => p.athleteId && !alreadyOnSeason.has(p.athleteId));
  if (missing.length === 0) return { roster: existing, teamRoster };

  // One upsert for the whole roster. This used to be one request per player in
  // series plus a full getSeason() refetch, which is what made provisioning a
  // season for a 25-player team take tens of seconds. The upsert ignores
  // athletes already enrolled (unique athlete-per-season), so a racing caller
  // is a no-op rather than the duplicate-key error this used to have to catch.
  onProgress?.(0, missing.length);
  const added = await ds.addSeasonPlayers(
    seasonId,
    missing.map((p) => ({ athleteId: p.athleteId!, jersey: p.jersey })),
  );
  onProgress?.(missing.length, missing.length);
  return { roster: [...existing, ...added], teamRoster };
}

/**
 * Events belong to a season, but the UI only exposes them at the team level —
 * coaches add practices and games from the team screen and never see the season
 * machinery. A team that has no season yet gets one silently on its first event,
 * which also covers teams created before seasons were auto-provisioned.
 */
export function useAddTeamEventMutation(
  teamId: string,
  teamName: string,
  seasonId: string | undefined,
  /**
   * Covers the two serial phases a team event can spend real time in on a big
   * roster: enrolling players onto the season roster, then writing each one's
   * invite. `phase` tells the caller which one a given (done, total) belongs
   * to, since they're separate totals — without it the bar jumps backwards
   * when the second phase starts against a different denominator.
   */
  onProgress?: (phase: 'roster' | 'invites', done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: import('@/data/types').CreateEventForm) => {
      let sid = seasonId;
      if (!sid) {
        const season = await getDataSource().createSeason({
          name: `${teamName} Season`,
          teamName,
          sport: 'Hockey',
          teamId,
        });
        sid = season.id;
        // addEventToSeasonCache() below no-ops when nothing is cached yet for
        // this season id — and a season created one line above has never been
        // fetched, so without this the coach's very first event on a brand-new
        // team season saved fine server-side but showed no roster/RSVP list
        // until the background invalidation refetch happened to land.
        qc.setQueryData(queryKeys.season(sid), season);
      }
      // Only the team's actual roster is invited. syncSeasonRosterFromTeam
      // also back-fills the season roster from every assessment ever attached
      // to the team (so those athletes are enrolled and reachable elsewhere),
      // but inviting all of them to every event let a team's invite count
      // balloon far past its real headcount — e.g. a team with 1000 players
      // ended up inviting 20000+ once several thousand-player test
      // assessments had been attached and detached over time. Intersecting
      // against teamRoster keeps invites scoped to who's actually on the team
      // right now.
      const { roster, teamRoster } = await syncSeasonRosterFromTeam(teamId, sid, (done, total) =>
        onProgress?.('roster', done, total),
      );
      const teamAthleteIds = new Set(teamRoster.map((p) => p.athleteId).filter(Boolean));
      const invitedRoster = roster.filter((p) => p.athleteId && teamAthleteIds.has(p.athleteId));
      // addSeasonEvent writes the invites and reports progress on them — this
      // was going unheard, so a big roster's "Save Event" sat on a bare spinner
      // with no sense of how long was left. On the RPC path it's one round trip
      // and the bar goes straight to done.
      const playerIds = invitedRoster.map((p) => p.id);
      // A repeating event becomes several, saved together and announced once.
      const forms = expandEventForms({ ...form, playerIds });
      const events =
        forms.length > 1
          ? await getDataSource().addSeasonEvents(sid, forms, (done, total) =>
              onProgress?.('invites', done, total),
            )
          : [
              await getDataSource().addSeasonEvent(sid, forms[0], (done, total) =>
                onProgress?.('invites', done, total),
              ),
            ];
      return { seasonId: sid, event: events[0], events, roster: invitedRoster };
    },
    onSuccess: ({ seasonId: sid, events, roster }) => {
      for (const event of events) addEventToSeasonCache(qc, sid, event, roster);
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.season(sid) });
    },
  });
}

export function useUpdateSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      updates,
    }: {
      eventId: string;
      updates: Partial<import('@/data/types').SeasonEvent>;
    }) => getDataSource().updateSeasonEvent(seasonId, eventId, updates),
    // Splices the server-returned event straight into the cached season, same
    // as addEventToSeasonCache above, so the schedule shows the edit the
    // moment save returns instead of waiting on the season refetch below —
    // the most expensive query in the app.
    onSuccess: (event) => {
      qc.setQueryData<import('@/data/types').Season>(queryKeys.season(seasonId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: prev.events
            .map((e) => (e.id === event.id ? { ...e, ...event } : e))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
      });
      void qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useDeleteSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => getDataSource().deleteSeasonEvent(seasonId, eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

/**
 * Backfills RSVPs for players just added to the roster onto events that
 * already existed — see addAthletesToEvents on DataSource for why this is
 * needed at all (a roster add never touches event_availability on its own).
 * Invalidates the season wholesale rather than patching the cache: the
 * schedule's per-event availability map is keyed by both roster id and
 * athlete id (see rowToSeasonEvent), which is fiddlier to splice in by hand
 * than to just re-fetch for what's normally a handful of new rows.
 */
export function useAddAthletesToEventsMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventIds, athleteIds }: { eventIds: string[]; athleteIds: string[] }) =>
      getDataSource().addAthletesToEvents(seasonId, eventIds, athleteIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

export function usePortalInviteMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, email }: { playerId: string; email: string }) =>
      getDataSource().sendPortalInvite(seasonId, playerId, email),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

/**
 * Invite season-roster players to the portal on every address each has on file.
 * This is the automatic link the roster screens fire the moment players are
 * added; usePortalInviteMutation is the manual button for one chosen address.
 *
 * `playerIds` narrows to specific roster entries, `emails` to specific
 * addresses; omit both to invite the whole season roster.
 */
export function useSeasonRosterInvitesMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerIds, emails }: { playerIds?: string[]; emails?: string[] } = {}) =>
      getDataSource().sendSeasonRosterInvites(seasonId, playerIds, emails),
    // The roster's "Portal invited" badge is derived from portal_invites.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

export function useSetAvailabilityMutation(seasonId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: ({
      eventId,
      playerId,
      response,
    }: {
      eventId: string;
      playerId: string;
      response: 'yes' | 'maybe' | 'no';
    }) => getDataSource().setEventAvailability(seasonId, eventId, playerId, response),
    onMutate: async ({ eventId, playerId, response }) => {
      await qc.cancelQueries({ queryKey: queryKeys.seasons });
      await qc.cancelQueries({ queryKey: queryKeys.season(seasonId) });
      if (userId) {
        await qc.cancelQueries({ queryKey: queryKeys.guardianRosters(userId) });
      }

      const previousSeasons = qc.getQueryData<any[]>(queryKeys.seasons);
      if (previousSeasons) {
        qc.setQueryData(
          queryKeys.seasons,
          previousSeasons.map((season) => {
            if (season.id === seasonId) {
              return {
                ...season,
                events: (season.events || []).map((event: any) => {
                  if (event.id === eventId) {
                    return {
                      ...event,
                      availability: {
                        ...(event.availability || {}),
                        [playerId]: response,
                      },
                    };
                  }
                  return event;
                }),
              };
            }
            return season;
          })
        );
      }

      const previousSeason = qc.getQueryData<any>(queryKeys.season(seasonId));
      if (previousSeason) {
        qc.setQueryData(queryKeys.season(seasonId), {
          ...previousSeason,
          events: (previousSeason.events || []).map((event: any) => {
            if (event.id === eventId) {
              return {
                ...event,
                availability: {
                  ...(event.availability || {}),
                  [playerId]: response,
                },
              };
            }
            return event;
          }),
        });
      }

      const previousRosters = userId ? qc.getQueryData<any[]>(queryKeys.guardianRosters(userId)) : undefined;
      if (userId && previousRosters) {
        qc.setQueryData(
          queryKeys.guardianRosters(userId),
          previousRosters.map((athlete) => {
            if (athlete.id === playerId) {
              return {
                ...athlete,
                seasons: (athlete.seasons || []).map((season: any) => {
                  if (season.id === seasonId) {
                    return {
                      ...season,
                      events: (season.events || []).map((event: any) => {
                        if (event.id === eventId) {
                          return {
                            ...event,
                            availability: {
                              ...(event.availability || {}),
                              [playerId]: response,
                            },
                          };
                        }
                        return event;
                      }),
                    };
                  }
                  return season;
                }),
              };
            }
            return athlete;
          })
        );
      }

      return { previousSeasons, previousSeason, previousRosters };
    },
    onError: (err, variables, context) => {
      if (context?.previousSeasons) {
        qc.setQueryData(queryKeys.seasons, context.previousSeasons);
      }
      if (context?.previousSeason) {
        qc.setQueryData(queryKeys.season(seasonId), context.previousSeason);
      }
      if (userId && context?.previousRosters) {
        qc.setQueryData(queryKeys.guardianRosters(userId), context.previousRosters);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
    },
  });
}

export function useSessionProgressQuery(tryoutId?: string, enabled = true) {
  return useQuery({
    queryKey: ['sessionProgress', tryoutId],
    queryFn: () => getDataSource().getSessionProgress(tryoutId!),
    enabled: !!tryoutId && enabled,
  });
}

export function useAthleteHistoryQuery(athleteId?: string) {
  return useQuery({
    queryKey: ['athleteHistory', athleteId],
    queryFn: () => getDataSource().getAthleteHistory(athleteId!),
    enabled: !!athleteId,
  });
}

/**
 * `alsoAthleteIds` are other athlete records that are the same person (see
 * getPlayerProfile); their evaluations are folded into this profile.
 */
export function usePlayerProfileQuery(athleteId?: string, alsoAthleteIds?: string[]) {
  const also = alsoAthleteIds?.length ? [alsoAthleteIds.join(',')] : [];
  return useQuery({
    queryKey: [...queryKeys.playerProfile(athleteId ?? ''), ...also],
    queryFn: () => getDataSource().getPlayerProfile(athleteId!, alsoAthleteIds),
    enabled: !!athleteId,
  });
}

/**
 * The count the Free plan's player cap is measured against: different players
 * across every evaluation and team in the account. Only fetched on the Free
 * plan, where evaluations and teams share one pool of players.
 */
export function useAccountPlayerCount(enabled: boolean): number {
  const q = useQuery({
    queryKey: ['accountPlayerCount'],
    queryFn: () => getDataSource().countActiveAthletes(),
    enabled,
    refetchOnMount: 'always',
  });
  return enabled ? (q.data ?? 0) : 0;
}

export const ATHLETE_HUB_PAGE = 60;

/** The Athlete Hub list: small pages, searched on the server. */
export function useAthleteHubQuery(search: string) {
  return useInfiniteQuery({
    queryKey: ['athletes', 'hub', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getDataSource().listAthleteHub(search, pageParam, ATHLETE_HUB_PAGE),
    getNextPageParam: (last) => last.next ?? undefined,
    retry: 1,
  });
}

export function useAthletesQuery() {
  return useQuery({
    queryKey: ['athletes'],
    queryFn: () => getDataSource().listAthletes(),
  });
}

// ---- Phase 4: Enterprise & Admin ----
export function useOrgQuery() {
  return useQuery({
    queryKey: queryKeys.org,
    queryFn: () => getDataSource().getOrg(),
  });
}

/**
 * Loyalty code, credit balance and ledger. Guardians have no tenant account, so
 * the underlying RPC would raise for them — the screen is coach-only and the
 * query stays disabled rather than surfacing that as an error.
 */
export function useReferralSummaryQuery(enabled = true) {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.referralSummary,
    queryFn: () => getDataSource().getReferralSummary(),
    enabled: !!userId && enabled,
  });
}

export function useApplyReferralCodeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => getDataSource().applyReferralCode(code),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.referralSummary }),
  });
}

export type OrgMembersQueryOptions = {
  includeTeamManagers?: boolean;
  /** When false, skip the athletes/guardian scan — much faster for large orgs. */
  includeGuardians?: boolean;
  enabled?: boolean;
};

export function useOrgMembersQuery(
  includeTeamManagersOrOpts: boolean | OrgMembersQueryOptions = false,
) {
  const userId = useAuthStore((s) => s.session?.user?.id);
  const opts: Required<OrgMembersQueryOptions> =
    typeof includeTeamManagersOrOpts === 'boolean'
      ? {
          includeTeamManagers: includeTeamManagersOrOpts,
          includeGuardians: true,
          enabled: true,
        }
      : {
          includeTeamManagers: includeTeamManagersOrOpts.includeTeamManagers ?? false,
          includeGuardians: includeTeamManagersOrOpts.includeGuardians ?? true,
          enabled: includeTeamManagersOrOpts.enabled ?? true,
        };
  const staffOnly = !opts.includeGuardians;
  return useQuery({
    queryKey: queryKeys.orgMembers(userId, opts.includeTeamManagers, staffOnly),
    queryFn: () =>
      getDataSource().listOrgMembers({
        includeTeamManagers: opts.includeTeamManagers,
        includeGuardians: opts.includeGuardians,
      }),
    enabled: !!userId && opts.enabled,
    // Permissions and the members tab both hit this; keep it warm so switching
    // tabs / remounting doesn't re-pay the round trip every time.
    staleTime: 60_000,
  });
}

export function useInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().inviteOrgMember(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useResendInviteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, email, role }: { userId: string; email: string; role: import('@/data/types').OrgRole }) =>
      (getDataSource() as any).resendGuardianInvite(userId, email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useCreateAndInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation<import('@/data/types').OrgMember, Error, { email: string; password: string; name: string; role: import('@/data/types').OrgRole }>({
    mutationFn: ({ email, password, name, role }) =>
      (getDataSource() as any).createAndInviteUser(email, password, name, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useUpdateMemberRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().updateOrgMemberRole(memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

export function useRemoveMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => getDataSource().removeOrgMember(memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers() }),
  });
}

// --- Team managers (CLUB mode) ---------------------------------------------

export function useTeamManagersQuery(teamId?: string) {
  return useQuery({
    queryKey: queryKeys.teamManagers(teamId),
    queryFn: () => getDataSource().listTeamManagers(teamId!),
    enabled: !!teamId,
  });
}

export function useInviteTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      email,
      role,
      name,
    }: {
      email: string;
      role: import('@/data/types').TeamManagerRole;
      name?: string;
    }) => getDataSource().inviteTeamManager(teamId, email, role, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) });
      // Manage Organization lists delegated managers too, so it goes stale here.
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useRemoveTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (managerId: string) => getDataSource().removeTeamManager(managerId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) });
      void qc.invalidateQueries({ queryKey: queryKeys.teams });
      void qc.invalidateQueries({ queryKey: queryKeys.orgMembers() });
    },
  });
}

export function useLinkGuardianMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guardianId, tryoutId, playerId }: { guardianId: string; tryoutId: string; playerId: string }) =>
      getDataSource().linkGuardianToAthlete(guardianId, tryoutId, playerId),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.guardianRosters() });
    },
  });
}

export function useGuardianRostersQuery() {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.guardianRosters(userId),
    queryFn: () => getDataSource().getGuardianRosters(),
    enabled: !!userId,
  });
}

/** Removes the guardian's athlete from a season's roster (guardian_leave_season RPC). */
export function useLeaveSeasonMutation() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: (seasonRosterId: string) => getDataSource().leaveSeason(seasonRosterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.guardianRosters(userId) });
      // The team roster row goes too, so anything showing that team's roster or
      // season is now a player out of date.
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
      qc.invalidateQueries({ queryKey: queryKeys.teams });
    },
  });
}

/** Deletes an athlete from the guardian's My Athletes list (guardian_remove_athlete RPC). */
export function useRemoveGuardianAthleteMutation() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: (athleteId: string) => getDataSource().removeGuardianAthlete(athleteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.guardianRosters(userId) }),
  });
}

export function useGuardianAthleteInfoQuery(athleteId: string | undefined) {
  return useQuery({
    queryKey: ['guardianAthleteInfo', athleteId ?? ''],
    queryFn: () => getDataSource().getGuardianAthleteInfo(athleteId!),
    enabled: !!athleteId,
  });
}

/** A guardian editing their own athlete from the portal. */
export function useUpdateGuardianAthleteMutation(athleteId: string) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useMutation({
    mutationFn: (patch: Parameters<DataSource['updateGuardianAthlete']>[1]) =>
      getDataSource().updateGuardianAthlete(athleteId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.guardianRosters(userId) });
      void qc.invalidateQueries({ queryKey: ['guardianAthleteInfo', athleteId] });
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
      void qc.invalidateQueries({ queryKey: ['athletes'] });
    },
  });
}

const familyContactsKey = (athleteId: string) => ['athletes', athleteId, 'familyContacts'] as const;

export function useFamilyContactsQuery(athleteId: string | undefined) {
  return useQuery({
    queryKey: familyContactsKey(athleteId ?? ''),
    queryFn: () => getDataSource().listFamilyContacts(athleteId!),
    enabled: !!athleteId,
  });
}

export function useAddFamilyContactMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contact: { name: string; relationship?: string; email?: string; phone?: string }) =>
      getDataSource().addFamilyContact(athleteId, contact),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyContactsKey(athleteId) }),
  });
}

export function useRemoveFamilyContactMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().removeFamilyContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyContactsKey(athleteId) }),
  });
}

export function useCreateTeamFeePaymentMutation() {
  return useMutation({
    mutationFn: ({ seasonRosterId, successUrl, cancelUrl }: { seasonRosterId: string; successUrl?: string; cancelUrl?: string }) =>
      getDataSource().createTeamFeePayment(seasonRosterId, successUrl, cancelUrl),
  });
}

// ---- Guardian -> Coach athlete profile sharing ----

export function useCoachDirectoryQuery() {
  return useQuery({
    queryKey: queryKeys.coachDirectory,
    queryFn: () => getDataSource().getCoachDirectory(),
  });
}

/**
 * On-demand (not a live query) — triggered once per "Find" tap rather than
 * on every keystroke, since it's a real network round trip per lookup.
 */
export function useFindCoachByEmailMutation() {
  return useMutation({
    mutationFn: (email: string) => getDataSource().findCoachByEmail(email),
  });
}

export function useAthleteSharesQuery(athleteId?: string) {
  return useQuery({
    queryKey: queryKeys.athleteShares(athleteId ?? ''),
    queryFn: () => getDataSource().getMyAthleteShares(athleteId!),
    enabled: !!athleteId,
  });
}

export function useSharedAthletesForCoachQuery() {
  return useQuery({
    queryKey: queryKeys.sharedAthletes,
    queryFn: () => getDataSource().getSharedAthletesForCoach(),
  });
}

export function useAthleteShareQuery(shareId?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: queryKeys.athleteShare(shareId ?? ''),
    queryFn: () => getDataSource().getAthleteShare(shareId!),
    enabled: !!shareId,
    // Scores on a share are a live overlay on top of the frozen snapshot (see
    // liveAthleteShareAssessments) — poll while this screen is open so a coach
    // watching a pending evaluation come in doesn't have to manually refresh.
    refetchInterval: options?.poll === false ? false : 15_000,
  });
}

export function useShareAthleteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, coachUserId, coachAccountId }: { athleteId: string; coachUserId: string; coachAccountId: string }) =>
      getDataSource().shareAthleteWithCoach(athleteId, coachUserId, coachAccountId),
    onSuccess: (_, { athleteId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShares(athleteId) });
    },
  });
}

export function useAcceptAthleteShareMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, tryoutId }: { shareId: string; tryoutId: string }) =>
      getDataSource().acceptAthleteShare(shareId, tryoutId),
    onSuccess: (share) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShare(share.id) });
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
      qc.invalidateQueries({ queryKey: queryKeys.athleteShares(share.athleteId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(true) });
      if (share.assignedTryoutId) {
        qc.invalidateQueries({ queryKey: queryKeys.tryout(share.assignedTryoutId) });
      }
    },
  });
}

export function useRejectAthleteShareMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => getDataSource().rejectAthleteShare(shareId),
    onSuccess: (share) => {
      qc.invalidateQueries({ queryKey: queryKeys.athleteShare(share.id) });
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
    },
  });
}

export function useShareCommentsQuery(shareId?: string) {
  return useQuery({
    queryKey: queryKeys.shareComments(shareId ?? ''),
    queryFn: () => getDataSource().listShareComments(shareId!),
    enabled: !!shareId,
  });
}

export function useAddShareCommentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, body }: { shareId: string; body: string }) =>
      getDataSource().addShareComment(shareId, body),
    onSuccess: (_, { shareId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.shareComments(shareId) });
    },
  });
}

// ---- Team chat ----
export function useTeamMessagesQuery(seasonId?: string) {
  return useQuery({
    queryKey: queryKeys.teamMessages(seasonId ?? ''),
    queryFn: () => getDataSource().listTeamMessages(seasonId!),
    enabled: !!seasonId,
  });
}

export function useSendTeamMessageMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seasonId, body }: { seasonId: string; body: string }) =>
      getDataSource().sendTeamMessage(seasonId, body),
    onSuccess: (_, { seasonId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) });
    },
  });
}

export function useDeleteTeamMessageMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => getDataSource().deleteTeamMessage(messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) }),
  });
}

/** People the user has blocked in team chat. */
export function useBlockedChatUsersQuery() {
  return useQuery({
    queryKey: queryKeys.chatBlockedUsers,
    queryFn: () => getDataSource().listBlockedChatUsers(),
  });
}

/** Blocking or unblocking changes what every open chat and unread badge shows. */
function invalidateChatForBlocks(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.chatBlockedUsers });
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'season' && q.queryKey[2] === 'messages' });
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'teamMessages' });
}

export function useBlockChatUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => getDataSource().blockChatUser(userId),
    onSuccess: () => invalidateChatForBlocks(qc),
  });
}

export function useUnblockChatUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => getDataSource().unblockChatUser(userId),
    onSuccess: () => invalidateChatForBlocks(qc),
  });
}

export function useReportTeamMessageMutation() {
  return useMutation({
    mutationFn: ({ messageId, reason, details }: { messageId: string; reason: ChatReportReason; details?: string }) =>
      getDataSource().reportTeamMessage(messageId, reason, details),
  });
}

// Unlike the other realtime hooks here, this one refetches immediately rather
// than on a 1s debounce — a visible delay between sending and seeing a message
// is what makes a chat feel broken.
export function useTeamChatRealtimeSync(seasonId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!seasonId) return;

    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:season_chat_${seasonId}_${uniqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'season_messages', filter: `season_id=eq.${seasonId}` },
        () => qc.invalidateQueries({ queryKey: queryKeys.teamMessages(seasonId) }),
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [seasonId, qc]);
}

/**
 * How many chat messages have arrived in this season since the user last had
 * the conversation open — what the Chat entry points badge.
 *
 * Never having opened it counts everything, which is the honest answer: the
 * badge then clears the first time they look. Subscribes to the same realtime
 * channel the chat itself uses, so the badge appears as the message lands.
 */
export function useChatUnreadCount(seasonId: string | undefined): number {
  const lastReadAt = useChatReadStore((s) => (seasonId ? (s.lastReadAt[seasonId] ?? 0) : 0));
  useTeamChatRealtimeSync(seasonId);
  const query = useQuery({
    queryKey: queryKeys.teamMessagesUnread(seasonId ?? '', lastReadAt),
    queryFn: () => getDataSource().countUnreadTeamMessages(seasonId!, lastReadAt),
    enabled: !!seasonId,
    // A stale badge is worse than a slightly chatty query: this is the number
    // the user is watching to decide whether to open the chat.
    staleTime: 30_000,
  });
  return query.data ?? 0;
}

export function useEnterprisePaymentsQuery() {
  return useQuery({
    queryKey: queryKeys.enterprisePayments,
    queryFn: () => getDataSource().getEnterprisePayments(),
  });
}

export function useConnectAccountStatusQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.connectAccountStatus,
    queryFn: () => getDataSource().getConnectAccountStatus(),
    enabled,
    // Each run is a live Stripe accounts.retrieve, and onboarding state barely
    // ever changes — well past the global 30s default. The post-onboarding poll
    // calls refetch() directly, which ignores this.
    staleTime: 5 * 60_000,
  });
}

export function useAdminStatsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminStats,
    queryFn: () => getDataSource().getAdminStats(),
    enabled,
  });
}

export function useAdminUsersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: () => getDataSource().listAdminUsers(),
    enabled,
  });
}

export function useOverridePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, planTier }: { userId: string; planTier: UserProfile['planTier'] }) =>
      getDataSource().overrideUserPlan(userId, planTier),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminUsers });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useCopyTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().copyTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useRestoreTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().restoreTryout(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tryouts'] });
    },
  });
}

export function useImportLibraryPlayersMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tryoutId,
      entries,
    }: {
      tryoutId: string;
      entries: { first: string; last: string; jersey?: string; pos?: string }[];
    }) => getDataSource().importLibraryPlayers(tryoutId, entries),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useSubmitFeedbackMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: import('../data/extras').FeedbackSubmission) =>
      getDataSource().submitFeedback(submission),
    // A reviewer who submits their own feedback should see it in the portal
    // without a reload; for everyone else this invalidates a query nobody has.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.feedbackSubmissions });
    },
  });
}

/**
 * Whether the signed-in user may read everyone's feedback.
 *
 * `staleTime: Infinity` — the allowlist is edited in the database by hand, so
 * it cannot change mid-session, and this gates a menu item.
 */
export function useIsFeedbackReviewerQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.feedbackReviewer,
    queryFn: () => getDataSource().isFeedbackReviewer(),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Every signed-in screen reads this to hide a blocked section and show a
 * blocked notice in its place — not just the founder console (which only
 * exists on web). `staleTime: Infinity` since it only ever changes when the
 * founder flips a switch on the web console.
 */
export function usePlatformBlockedFeaturesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformBlockedFeatures,
    queryFn: () => getDataSource().getPlatformBlockedFeatures(),
    enabled,
    staleTime: Infinity,
  });
}

/** The Plans & Billing screen reads this to hide checkout/upgrade for one plan tier platform-wide. */
export function usePlatformBlockedPlanTiersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformBlockedPlanTiers,
    queryFn: () => getDataSource().getPlatformBlockedPlanTiers(),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Which plan tiers the founder has switched the dummy-data tools off for. Read
 * by every screen that offers them, so — like the feature blocks above — it only
 * changes when the founder flips a switch and a stale copy is harmless.
 */
export function useDummyDataBlockedPlanTiersQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.dummyDataBlockedPlanTiers,
    queryFn: () => getDataSource().getDummyDataBlockedPlanTiers(),
    enabled,
    staleTime: Infinity,
  });
}

export function useFeedbackSubmissionsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.feedbackSubmissions,
    queryFn: () => getDataSource().listFeedbackSubmissions(),
    enabled,
  });
}

export function useAddSeasonPlayerMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seasonId,
      player,
    }: {
      seasonId: string;
      player: Omit<import('../data/types').SeasonPlayer, 'id'>;
    }) => withTimeout(getDataSource().addSeasonPlayer(seasonId, player), 15000),
    onSuccess: (_, { seasonId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useImportSeasonPlayersFromTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seasonId: string) => getDataSource().importSeasonPlayersFromTeam(seasonId),
    onSuccess: (_, seasonId) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useEmailScheduleMutation() {
  return useMutation({
    mutationFn: (seasonId: string) => getDataSource().emailScheduleToPlayers(seasonId),
  });
}

export function useUpdateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Team> }) => {
      const team = await getDataSource().updateTeam(id, updates);
      // A team's fee is tracked per season_roster row, not on team_roster
      // directly (20260811183700_season_team_fee_payments.sql), and a season
      // is normally provisioned lazily the first time the coach adds an event
      // (see useAddTeamEventMutation). Turning fees on here needs that same
      // provisioning + sync — otherwise players already on the roster never
      // get a season_roster row and their guardians never see the fee.
      if (updates.collectsFees) {
        const ds = getDataSource();
        let season = (await ds.listSeasons()).find((s) => s.teamId === id);
        if (!season) {
          season = await ds.createSeason({ name: `${team.name} Season`, teamName: team.name, sport: 'Hockey', teamId: id });
        }
        await syncSeasonRosterFromTeam(id, season.id);
        qc.invalidateQueries({ queryKey: queryKeys.seasons });
        qc.invalidateQueries({ queryKey: queryKeys.season(season.id) });
      }
      return team;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
  });
}

export function useArchiveTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().archiveTeam(id),
    onSuccess: () => {
      // Prefix match: refreshes the active list and the archived list.
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Its schedule is archived with it.
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useDeleteTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteTeam(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
      // Deleting a team detaches its assessments and retires its season.
      qc.invalidateQueries({ queryKey: ['tryouts'] });
      qc.invalidateQueries({ queryKey: queryKeys.seasons });
    },
  });
}

export function useImportScanScoresMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tryoutId,
      scores,
      session,
    }: {
      tryoutId: string;
      scores: { playerId: string; rubricKey: string; value: number }[];
      session?: string;
    }) => getDataSource().importScanScores(tryoutId, scores, session),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}

export function useConnectedFamilyContactIdsQuery(athleteId: string | undefined) {
  return useQuery({
    queryKey: [...familyContactsKey(athleteId ?? ''), 'connected'],
    queryFn: () => getDataSource().listConnectedFamilyContactIds(athleteId!),
    enabled: !!athleteId,
  });
}

export const teamCalendarLinksKey = ['team-calendar-links'] as const;

/** Which team calendars are attached to which other teams. */
export function useTeamCalendarLinksQuery() {
  return useQuery({
    queryKey: teamCalendarLinksKey,
    queryFn: () => getDataSource().listTeamCalendarLinks(),
  });
}

export function useSetTeamCalendarLinkMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ viewerTeamId, sourceTeamId, attached }: { viewerTeamId: string; sourceTeamId: string; attached: boolean }) =>
      getDataSource().setTeamCalendarLink(viewerTeamId, sourceTeamId, attached),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: teamCalendarLinksKey });
    },
  });
}

export function useLinkFamilyContactGuardianMutation() {
  return useMutation({
    mutationFn: ({ contactId, userId }: { contactId: string; userId: string }) =>
      getDataSource().linkFamilyContactGuardian(contactId, userId),
  });
}

// ---- Player selection letters ----

export function useLetterTemplatesQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.letterTemplates,
    queryFn: () => getDataSource().listLetterTemplates(),
    enabled: options?.enabled ?? true,
  });
}

export function useCreateLetterTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; kind: LetterKind; subject: string; body: string; tryoutId?: string }) =>
      getDataSource().createLetterTemplate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.letterTemplates });
    },
  });
}

export function useUpdateLetterTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ name: string; kind: LetterKind; subject: string; body: string }>;
    }) => getDataSource().updateLetterTemplate(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.letterTemplates });
    },
  });
}

export function useDeleteLetterTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deleteLetterTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.letterTemplates });
    },
  });
}

export function usePlayerLettersQuery(tryoutId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerLetters(tryoutId ?? ''),
    queryFn: () => getDataSource().listPlayerLetters(tryoutId!),
    enabled: !!tryoutId,
  });
}

/**
 * One player's letters, fetched pre-filtered instead of pulling the whole
 * assessment's and filtering client-side — see PlayerHubScreen, the one
 * caller that only ever needs a single player's copies.
 */
export function usePlayerLettersForParticipantQuery(tryoutId: string | undefined, participantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerLettersForParticipant(tryoutId ?? '', participantId ?? ''),
    queryFn: () => getDataSource().listPlayerLetters(tryoutId!, participantId!),
    enabled: !!tryoutId && !!participantId,
  });
}

export function useSendPlayerLettersMutation(
  tryoutId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      letters: {
        playerId: string;
        playerName: string;
        athleteId?: string;
        templateId?: string;
        kind: LetterKind;
        subject: string;
        body: string;
        recipientEmail?: string;
      }[],
    ) => getDataSource().sendPlayerLetters(tryoutId, letters, onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.playerLetters(tryoutId) });
    },
  });
}

export function useUpdatePlayerLetterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ subject: string; body: string; recipientEmail: string }>;
    }) => getDataSource().updatePlayerLetter(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.playerLetters(tryoutId) });
    },
  });
}

export function useResendPlayerLetterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().resendPlayerLetter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.playerLetters(tryoutId) });
    },
  });
}

export function useDeletePlayerLetterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getDataSource().deletePlayerLetter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.playerLetters(tryoutId) });
    },
  });
}


// ---- Event comments & files ----

const eventCommentsKey = (eventId: string) => ['event-comments', eventId] as const;
const eventFilesKey = (eventId: string) => ['event-files', eventId] as const;

export function useEventCommentsQuery(eventId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: eventCommentsKey(eventId ?? ''),
    queryFn: () => getDataSource().listEventComments(eventId!),
    enabled: !!eventId && options?.enabled !== false,
  });
}

export function useAddEventCommentMutation(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => getDataSource().addEventComment(eventId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventCommentsKey(eventId) }),
  });
}

export function useDeleteEventCommentMutation(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => getDataSource().deleteEventComment(commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventCommentsKey(eventId) }),
  });
}

export function useEventFilesQuery(eventId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: eventFilesKey(eventId ?? ''),
    queryFn: () => getDataSource().listEventFiles(eventId!),
    enabled: !!eventId && options?.enabled !== false,
  });
}

export function useUploadEventFileMutation(seasonId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: { uri: string; name: string; type: string; size: number }) =>
      getDataSource().uploadEventFile(seasonId, eventId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventFilesKey(eventId) }),
  });
}

export function useDeleteEventFileMutation(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: import('@/data/types').EventFile) => getDataSource().deleteEventFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventFilesKey(eventId) }),
  });
}


// ---- Player report cards ----

const reportCardsKey = (athleteId: string) => ['report-cards', athleteId] as const;

export function usePlayerReportCardsQuery(athleteId: string | undefined) {
  return useQuery({
    queryKey: reportCardsKey(athleteId ?? ''),
    queryFn: () => getDataSource().listPlayerReportCards(athleteId!),
    enabled: !!athleteId,
  });
}

export function useSavePlayerReportCardMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: import('@/data/types').PlayerReportCardInput; files?: { uri: string; name: string; type: string; size: number }[] }) =>
      getDataSource().savePlayerReportCard(args.input, args.files),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportCardsKey(athleteId) }),
  });
}

export function useDeletePlayerReportCardMutation(athleteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (card: import('@/data/types').PlayerReportCard) => getDataSource().deletePlayerReportCard(card),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportCardsKey(athleteId) }),
  });
}

export function useGenerateReportCardCommentsMutation(tryoutId: string) {
  return useMutation({
    mutationFn: (args: { playerId: string; evalIds: string[] }) =>
      getDataSource().generateReportCardComments(tryoutId, args.playerId, args.evalIds),
  });
}

// ---- Library ----

const libraryKey = ['library'] as const;

export function useLibraryQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: libraryKey,
    queryFn: () => getDataSource().listLibraryItems(),
    enabled: options?.enabled !== false,
  });
}

export function useCreateLibraryItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { input: import('@/data/types').LibraryItemInput; file?: { uri: string; name: string; type: string; size: number } }) =>
      getDataSource().createLibraryItem(args.input, args.file),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKey }),
  });
}

export function useUpdateLibraryItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; updates: Partial<import('@/data/types').LibraryItemInput> }) =>
      getDataSource().updateLibraryItem(args.id, args.updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKey }),
  });
}

export function useDeleteLibraryItemMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: import('@/data/types').LibraryItem) => getDataSource().deleteLibraryItem(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKey }),
  });
}

// ---- Video storage add-on ----

export const videoStorageKey = (accountId?: string) => ['video-storage', accountId ?? 'own'] as const;
export const accountVideosKey = (accountId?: string) => ['account-videos', accountId ?? 'own'] as const;
export const videosForContextKey = (context: string, ids: string[]) => ['videos-for-context', context, ...ids] as const;

/** Meter numbers, plan state and who may upload. `accountId` defaults to the signed-in user's own account. */
export function useVideoStorageQuery(accountId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: videoStorageKey(accountId),
    queryFn: () => getDataSource().getVideoStorage(accountId),
    enabled: options?.enabled !== false,
    staleTime: 30_000,
  });
}

export function useAccountVideosQuery(accountId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountVideosKey(accountId),
    queryFn: () => getDataSource().listAccountVideos(accountId),
    enabled: options?.enabled !== false,
  });
}

export function useVideosForContextQuery(
  context: import('@/data/videoStorage').VideoContext,
  contextIds: string[],
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: videosForContextKey(context, contextIds),
    queryFn: () => getDataSource().listVideosForContext(context, contextIds),
    enabled: options?.enabled !== false && contextIds.length > 0,
    // Playback addresses are signed for an hour.
    staleTime: 20 * 60_000,
  });
}

/** The account that owns the storage for something videos attach to (a manager works in the club's account, not their own). */
export function useVideoContextAccountQuery(
  context: import('@/data/videoStorage').VideoContext,
  contextId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['video-context-account', context, contextId ?? ''] as const,
    queryFn: () => getDataSource().getVideoContextAccount(context, contextId!),
    enabled: options?.enabled !== false && !!contextId,
    staleTime: 10 * 60_000,
  });
}

/** Everything a stored video touches: the meter, the Storage list, the lists it is attached to, the Library. */
export function useInvalidateVideoStorage() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['video-storage'] });
    qc.invalidateQueries({ queryKey: ['account-videos'] });
    qc.invalidateQueries({ queryKey: ['videos-for-context'] });
    qc.invalidateQueries({ queryKey: libraryKey });
  };
}

export function useDeleteAccountVideoMutation() {
  const invalidate = useInvalidateVideoStorage();
  return useMutation({
    mutationFn: (videoId: string) => getDataSource().deleteAccountVideo(videoId),
    onSuccess: invalidate,
  });
}

export function useSetVideoPermissionsMutation() {
  const invalidate = useInvalidateVideoStorage();
  return useMutation({
    mutationFn: (args: { accountId: string; managersCanUpload?: boolean; viewersCanDownload?: boolean }) =>
      getDataSource().setVideoPermissions(args.accountId, {
        managersCanUpload: args.managersCanUpload,
        viewersCanDownload: args.viewersCanDownload,
      }),
    onSuccess: invalidate,
  });
}

export function useManageVideoStorageMutation() {
  const invalidate = useInvalidateVideoStorage();
  return useMutation({
    mutationFn: (args: { action: 'change' | 'cancel' | 'resume'; storageGb?: number; confirm?: string }) =>
      getDataSource().manageVideoStorage(args.action, { storageGb: args.storageGb, confirm: args.confirm }),
    onSuccess: invalidate,
  });
}

// ---- Team feed & organization info ----

const seasonPostsKey = (seasonId: string) => ['season-posts', seasonId] as const;
const postCommentsKey = (postId: string) => ['post-comments', postId] as const;
const orgInfoKey = (seasonId: string) => ['org-info', seasonId] as const;

type FeedUpload = { uri: string; name: string; type: string; size: number };

/** The post or item itself was saved; only some of its files did not go up. */
export class FeedUploadError extends Error {}

/** Uploads each file in turn; a failure names the file but leaves what already went up. */
async function uploadAll(files: FeedUpload[], upload: (file: FeedUpload) => Promise<unknown>) {
  const failed: string[] = [];
  for (const file of files) {
    try {
      await upload(file);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : file.name);
    }
  }
  if (failed.length) throw new FeedUploadError(`Saved, but not every file uploaded. ${failed.join(' ')} Attach them again.`);
}

export function useSeasonPostsQuery(seasonId: string | undefined) {
  return useQuery({
    queryKey: seasonPostsKey(seasonId ?? ''),
    queryFn: () => getDataSource().listSeasonPosts(seasonId!),
    enabled: !!seasonId,
  });
}

export function useCreateSeasonPostMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; body: string; files: FeedUpload[] }) => {
      const post = await getDataSource().addSeasonPost(seasonId, { title: input.title, body: input.body });
      await uploadAll(input.files, (f) => getDataSource().uploadPostFile(seasonId, post.id, f));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: seasonPostsKey(seasonId) }),
  });
}

export function useDeleteSeasonPostMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (post: import('@/data/types').SeasonPost) => getDataSource().deleteSeasonPost(post),
    onSuccess: () => qc.invalidateQueries({ queryKey: seasonPostsKey(seasonId) }),
  });
}

export function useDeletePostFileMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: import('@/data/types').FeedFile) => getDataSource().deletePostFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: seasonPostsKey(seasonId) }),
  });
}

export function usePostCommentsQuery(postId: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: postCommentsKey(postId ?? ''),
    queryFn: () => getDataSource().listPostComments(postId!),
    enabled: !!postId && options?.enabled !== false,
  });
}

export function useAddPostCommentMutation(seasonId: string, postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => getDataSource().addPostComment(postId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: postCommentsKey(postId) });
      qc.invalidateQueries({ queryKey: seasonPostsKey(seasonId) });
    },
  });
}

export function useDeletePostCommentMutation(seasonId: string, postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => getDataSource().deletePostComment(commentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: postCommentsKey(postId) });
      qc.invalidateQueries({ queryKey: seasonPostsKey(seasonId) });
    },
  });
}

export function useOrgInfoQuery(seasonId: string | undefined) {
  return useQuery({
    queryKey: orgInfoKey(seasonId ?? ''),
    queryFn: () => getDataSource().listOrgInfo(seasonId!),
    enabled: !!seasonId,
  });
}

export function useCreateOrgInfoMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: import('@/data/types').OrgInfoInput & { files: FeedUpload[] }) => {
      const { files, ...fields } = input;
      const item = await getDataSource().addOrgInfo(seasonId, fields);
      await uploadAll(files, (f) => getDataSource().uploadOrgInfoFile(item.accountId, item.id, f));
    },
    // Org info is shared by every team of the account, so refresh all of them.
    onSettled: () => qc.invalidateQueries({ queryKey: ['org-info'] }),
  });
}

export function useDeleteOrgInfoMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: import('@/data/types').OrgInfoItem) => getDataSource().deleteOrgInfo(item),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-info'] }),
  });
}

export function useDeleteOrgInfoFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: import('@/data/types').FeedFile) => getDataSource().deleteOrgInfoFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-info'] }),
  });
}
