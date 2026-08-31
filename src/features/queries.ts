import { getDataSource } from '@/data';
import type { DummyDataOptions, DummyTeamOptions } from '@/data/testDataGenerator';
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
  Tryout,
  UserProfile,
} from '@/data/types';
import { queryKeys } from '@/lib/queryClient';
import { getSupabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useCreateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, season }: { name: string; season?: string }) =>
      getDataSource().createTeam(name, season),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.teams });
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

// ---- Team roster ----
const teamRosterKey = (teamId: string) => ['teams', teamId, 'roster'] as const;

export function useTeamRosterQuery(teamId: string | undefined) {
  return useQuery({
    queryKey: teamRosterKey(teamId ?? ''),
    queryFn: () => getDataSource().listTeamRoster(teamId!),
    enabled: !!teamId,
    // Same reasoning as useTryoutQuery's gcTime: a roster read is several
    // round trips plus a per-athlete fee lookup, so dropping the entry after
    // the 5-minute default means stepping out of a team and back in lands on a
    // blocking spinner instead of the list. Held long enough that the return
    // trip renders from cache and refetches quietly underneath.
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
    onSuccess: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
  });
}

export function useAddManualTeamPlayerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => getDataSource().addManualTeamPlayer(teamId, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
  });
}

export function useUploadTeamPlayerPhotoMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ athleteId, fileUri, fileType }: { athleteId: string; fileUri: string; fileType: string }) =>
      getDataSource().uploadPlayerPhoto(athleteId, fileUri, fileType),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamRosterKey(teamId) }),
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
      qc.setQueryData<TeamRosterPlayer[] | undefined>(teamRosterKey(teamId), (old) =>
        old?.filter((p) => p.athleteId !== athleteId),
      );
      qc.invalidateQueries({ queryKey: teamRosterKey(teamId) });
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

    // Subscribe to insert/update events on the evaluations table for this specific tryout
    const uniqueId = Math.random().toString(36).slice(2, 9);
    const channel = getSupabase()
      .channel(`realtime:tryout_${id}_${uniqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluations', filter: `tryout_id=eq.${id}` },
        () => triggerInvalidate()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'evaluation_scores' },
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
    mutationFn: (form: CreateAssessmentForm) => withTimeout(getDataSource().createTryout(form), 15000),
    onSuccess: (tryout) => {
      // Seed the single-tryout cache with what the create call already
      // returned — without this, navigating straight to the new assessment's
      // settings screen lands useTryoutQuery on an empty cache, which refetches
      // the whole roster+evaluations bundle behind a blocking spinner instead
      // of rendering immediately.
      qc.setQueryData(queryKeys.tryout(tryout.id), tryout);
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Tryout> }) =>
      withTimeout(getDataSource().updateTryout(id, updates), 15000),
    onSuccess: (tryout) => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryout.id) });
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
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdatePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, updates }: { playerId: string; updates: Partial<import('@/data/types').Player> }) =>
      withTimeout(getDataSource().updatePlayer(tryoutId, playerId, updates), 15000),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
      // The deleted player may have come from an accepted athlete share, which
      // deletePlayer flips to 'released' as a side effect — refresh that list too.
      qc.invalidateQueries({ queryKey: queryKeys.sharedAthletes });
      // Their guardian is dropped with them once they are off every roster, so
      // the member directory that derives guardians from athletes is now stale.
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
        5000,
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
    },
  });
}

// ---- Registration ----
export function useRegistrationsQuery(tryoutId: string) {
  return useQuery({
    queryKey: queryKeys.registrations(tryoutId),
    queryFn: () => getDataSource().listRegistrations(tryoutId),
    enabled: !!tryoutId,
    refetchInterval: 20_000,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
export function useSeasonsQuery() {
  return useQuery({
    queryKey: queryKeys.seasons,
    queryFn: () => getDataSource().listSeasons(),
  });
}

export function useSeasonQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.season(id ?? ''),
    queryFn: () => getDataSource().getSeason(id!),
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
    mutationFn: (form: import('@/data/types').CreateEventForm) =>
      getDataSource().addSeasonEvent(seasonId, form, onProgress),
    onSuccess: (event, form) => {
      const cached = qc.getQueryData<import('@/data/types').Season>(queryKeys.season(seasonId));
      const roster = cached?.roster ?? [];
      const invitedRoster = form.playerIds?.length
        ? roster.filter((p) => form.playerIds!.includes(p.id))
        : roster;
      addEventToSeasonCache(qc, seasonId, event, invitedRoster);
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
      const event = await getDataSource().addSeasonEvent(sid, { ...form, playerIds }, (done, total) =>
        onProgress?.('invites', done, total),
      );
      return { seasonId: sid, event, roster: invitedRoster };
    },
    onSuccess: ({ seasonId: sid, event, roster }) => {
      addEventToSeasonCache(qc, sid, event, roster);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
  });
}

export function useDeleteSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => getDataSource().deleteSeasonEvent(seasonId, eventId),
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

export function useAthleteHistoryQuery(athleteId?: string) {
  return useQuery({
    queryKey: ['athleteHistory', athleteId],
    queryFn: () => getDataSource().getAthleteHistory(athleteId!),
    enabled: !!athleteId,
  });
}

export function usePlayerProfileQuery(athleteId?: string) {
  return useQuery({
    queryKey: queryKeys.playerProfile(athleteId ?? ''),
    queryFn: () => getDataSource().getPlayerProfile(athleteId!),
    enabled: !!athleteId,
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

export function useOrgMembersQuery() {
  const userId = useAuthStore((s) => s.session?.user?.id);
  return useQuery({
    queryKey: queryKeys.orgMembers(userId),
    queryFn: () => getDataSource().listOrgMembers(),
    enabled: !!userId,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) }),
  });
}

export function useRemoveTeamManagerMutation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (managerId: string) => getDataSource().removeTeamManager(managerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teamManagers(teamId) }),
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

export function useAthleteShareQuery(shareId?: string) {
  return useQuery({
    queryKey: queryKeys.athleteShare(shareId ?? ''),
    queryFn: () => getDataSource().getAthleteShare(shareId!),
    enabled: !!shareId,
    // Scores on a share are a live overlay on top of the frozen snapshot (see
    // liveAthleteShareAssessments) — poll while this screen is open so a coach
    // watching a pending evaluation come in doesn't have to manually refresh.
    refetchInterval: 15_000,
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
  return useMutation({
    mutationFn: (submission: import('../data/extras').FeedbackSubmission) =>
      getDataSource().submitFeedback(submission),
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
    }: {
      tryoutId: string;
      scores: { playerId: string; rubricKey: string; value: number }[];
    }) => getDataSource().importScanScores(tryoutId, scores),
    onSuccess: (_, { tryoutId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
    },
  });
}
