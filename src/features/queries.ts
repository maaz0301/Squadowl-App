import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDataSource } from '@/data';
import type {
  AddPlayerForm,
  CreateAssessmentForm,
  ScoreForm,
  RegistrationSubmit,
  Tryout,
  Team,
  UserProfile,
} from '@/data/types';
import { queryKeys } from '@/lib/queryClient';
import {
  getPlayerRubrics,
  weightedOverall,
  type RubricCategory,
} from '@/data/rubrics';
import type { AssessorProgress, PlayerResult, Recommendation } from '@/data/types';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
  });
}

// ---- Tryouts ----
export function useTryoutsQuery(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.tryouts(includeArchived),
    queryFn: () => getDataSource().listTryouts(includeArchived),
  });
}

export function useAssignedTryoutsQuery() {
  return useQuery({
    queryKey: queryKeys.assignedTryouts,
    queryFn: () => getDataSource().listAssignedTryouts(),
  });
}

export function useTryoutQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tryout(id ?? ''),
    queryFn: () => getDataSource().getTryout(id!),
    enabled: !!id,
  });
}

export function useCreateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: CreateAssessmentForm) => getDataSource().createTryout(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUpdateTryoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Tryout> }) =>
      getDataSource().updateTryout(id, updates),
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

// ---- Players ----
export function useAddPlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: AddPlayerForm) => getDataSource().addPlayer(tryoutId, form),
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
      getDataSource().updatePlayer(tryoutId, playerId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
  });
}

export function useDeletePlayerMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => getDataSource().deletePlayer(tryoutId, playerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
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
    }) => getDataSource().saveEvaluation(tryoutId, playerId, form, evalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.results(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
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
    onSuccess: (tryout) => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryout.id) }),
  });
}

export function useSubmitRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: RegistrationSubmit) => getDataSource().submitRegistration(tryoutId, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) }),
  });
}

export function useAddRegistrationToRosterMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      getDataSource().addRegistrationToRoster(tryoutId, registrationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) });
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useDismissRegistrationMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      getDataSource().dismissRegistration(tryoutId, registrationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.registrations(tryoutId) }),
  });
}

import { computeAssessorProgress, computePlayerResults } from '@/data/scoring';

export { computePlayerResults, computeAssessorProgress } from '@/data/scoring';

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
    mutationFn: (updates: Partial<UserProfile>) => getDataSource().updateProfile(updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.profile }),
  });
}

// ---- Phase 2: Team Builder, AI, Export ----
export function useGenerateTeamBuilderMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: import('@/data/teamBuilder').TeamBuilderConfig) =>
      getDataSource().generateTeamBuilder(tryoutId, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
  });
}

export function useAiPlayerSummaryMutation(tryoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => getDataSource().getAiPlayerSummary(tryoutId, playerId),
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
    mutationFn: (form: import('@/data/types').CreateSeasonForm) => getDataSource().createSeason(form),
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

export function useAddSeasonEventMutation(seasonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: import('@/data/types').CreateEventForm) =>
      getDataSource().addSeasonEvent(seasonId, form),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) }),
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
  return useQuery({
    queryKey: queryKeys.orgMembers,
    queryFn: () => getDataSource().listOrgMembers(),
  });
}

export function useInviteMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().inviteOrgMember(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers }),
  });
}

export function useUpdateMemberRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: import('@/data/types').OrgRole }) =>
      getDataSource().updateOrgMemberRole(memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers }),
  });
}

export function useRemoveMemberMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => getDataSource().removeOrgMember(memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.orgMembers }),
  });
}

export function useLinkGuardianMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ guardianId, tryoutId, playerId }: { guardianId: string; tryoutId: string; playerId: string }) =>
      getDataSource().linkGuardianToAthlete(guardianId, tryoutId, playerId),
    onSuccess: (_, { tryoutId }) => qc.invalidateQueries({ queryKey: queryKeys.tryout(tryoutId) }),
  });
}

export function useEnterprisePaymentsQuery() {
  return useQuery({
    queryKey: queryKeys.enterprisePayments,
    queryFn: () => getDataSource().getEnterprisePayments(),
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
    }) => getDataSource().addSeasonPlayer(seasonId, player),
    onSuccess: (_, { seasonId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.season(seasonId) });
    },
  });
}

export function useUpdateTeamMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Team> }) =>
      getDataSource().updateTeam(id, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.teams }),
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
