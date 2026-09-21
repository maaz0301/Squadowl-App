import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, Alert, Pressable, Platform, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useThemeColors } from '@/theme/ThemeProvider';
import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink, MapLocationHint } from '@/components/MapLink';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';
import { Avatar, Badge, Button, Card, Chip, DateField, ErrorState, Header, Input, LoadingState, Modal, Screen, Tabs, TimeField } from '@/components/ui';
import { useTeamsQuery, useAssessmentAthletesQuery, useTryoutSummariesQuery, useUpdateTeamMutation, useDeleteTeamMutation, useUpdateTryoutMutation, useCreateTryoutMutation, useTeamRosterPagesQuery, useTeamRosterAthleteIdsQuery, useAddTeamRosterPlayersMutation, useAddManualTeamPlayerMutation, useImportTeamRosterPlayersMutation, useUploadTeamPlayerPhotoMutation, useRemoveTeamRosterPlayerMutation, useRemoveTeamRosterPlayersMutation, useTeamRosterInvitesMutation, useSeasonSummariesQuery, useSeasonQuery, useSeasonRealtimeSync, useAddTeamEventMutation, useUpdateSeasonEventMutation, useDeleteSeasonEventMutation, useUploadTeamLogoMutation, useSetAvailabilityMutation, useGenerateTestDataMutation, useClearTestDataMutation } from '@/features/queries';
import { useUser, usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { canUseFeature, effectiveTierForTeam, isAtPlayerLimit } from '@/data/plans';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { CreateEventFormSchema, type AddPlayerForm as AddPlayerFormValues, type CreateEventForm, type EventKind, type SeasonEvent } from '@/data/types';
import { BottomNav } from '@/components/BottomNav';
import { ChatIconButton } from '@/components/ChatIconButton';
import { ImportPlayersModal } from '@/components/roster/ImportPlayersModal';
import { DeleteProgressModal } from '@/components/DeleteProgressModal';
import { RosterSelectToolbar } from '@/components/roster/RosterControls';
import { LetterTemplatesManager } from '@/components/letters/LetterTemplatesManager';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';
import { PlanGate } from '@/components/PlanGate';
import { TeamBanner } from '@/components/TeamBanner';
import { teamBrandSurfaces } from '@/lib/teamBrand';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { TeamManagersCard } from '@/components/TeamManagersCard';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { getDataSource } from '@/data';
import { queryKeys } from '@/lib/queryClient';
import { DUMMY_LIMITS, clampOption } from '@/data/testDataGenerator';

function feeCentsFromInput(feeInput: string): number {
  const dollars = parseFloat(feeInput);
  return !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
}

type Rsvp = 'yes' | 'maybe' | 'no' | 'pending';

const RSVP_LABEL: Record<Rsvp, string> = {
  yes: 'Yes',
  maybe: 'Maybe',
  no: 'No',
  pending: 'No reply',
};

const RSVP_VARIANT: Record<Rsvp, 'success' | 'warning' | 'danger' | 'info'> = {
  yes: 'success',
  maybe: 'warning',
  no: 'danger',
  pending: 'info',
};

type RsvpRow = { playerId: string; name: string; response: Rsvp };
type RsvpSummary = { counts: Record<Rsvp, number>; rows: RsvpRow[] };

const EMPTY_RSVP: RsvpSummary = { counts: { yes: 0, maybe: 0, no: 0, pending: 0 }, rows: [] };

// A season roster can run to four figures; mounting every RSVP row at once is
// what made the expander feel like it hung, so the list grows on demand.
const RSVP_PAGE = 25;
/** Matches listTeamRosterPage's own page size — see TEAM_ROSTER_SCREEN_PAGE. */
const TEAM_ROSTER_PAGE = 50;

export default function TeamDetailScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
  const teamsQuery = useTeamsQuery();
  // The badges, tab counts, Assessments tab and Attach modal only need names
  // and headcounts, so they run off this light read — see
  // useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(false);
  // Dummy data generation writes onto a linked evaluation, so it targets this
  // team's first one — auto-created on demand below if there isn't one yet.
  // Computed off route params (not `team.id`, which isn't resolved yet) so
  // these mutation hooks can be declared before any early return below.
  const dummyTryoutId = (tryoutsQuery.data ?? []).find((t) => t.teamId === id)?.id ?? '';
  const [showTestGen, setShowTestGen] = useState(false);
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(dummyTryoutId, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(dummyTryoutId);
  const createDummyTryout = useCreateTryoutMutation();
  const [preparingDummyTryout, setPreparingDummyTryout] = useState(false);
  const [dummyPlayerCount, setDummyPlayerCount] = useState('25');
  const qc = useQueryClient();
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const updateTryout = useUpdateTryoutMutation();
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const { canManageTeam } = usePermissions();
  const teamManagedForPerm = teamsQuery.data?.find((t) => t.id === id)?.managed;
  const [editing, setEditing] = useState(false);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  // Full assessment reads (every roster entry joined to its athlete, every
  // evaluation, score and registration for the whole account) are the heaviest
  // query in the app — see listTryouts(). The add-players candidate picker only
  // ever needed the athlete fields, so it reads listAssessmentAthletes()
  // instead — deferred until the picker is actually open rather than paid for
  // on every visit to this screen.
  const assessmentAthletesQuery = useAssessmentAthletesQuery(showAddPlayers);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // TEMP DIAGNOSTIC: logs tap-to-visible time for the Add Players modal so we
  // can see whether the delay is JS-side (state/render) or native/animation.
  // Remove once the modal open speed is confirmed fixed.
  const addPlayersPressAt = useRef<number | null>(null);
  useEffect(() => {
    if (showAddPlayers && addPlayersPressAt.current != null) {
      const ms = performance.now() - addPlayersPressAt.current;
      console.log(`[perf] Add Players modal committed visible after ${ms.toFixed(1)}ms`);
      addPlayersPressAt.current = null;
    }
  }, [showAddPlayers]);
  const [pickedAthletes, setPickedAthletes] = useState<Set<string>>(new Set());
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateTryoutFilter, setCandidateTryoutFilter] = useState<string | null>(null);
  const [enrollingAssessments, setEnrollingAssessments] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [tab, setTab] = useState(route.params?.tab === 'settings' ? 'settings' : 'schedule');
  const [openRsvpEventId, setOpenRsvpEventId] = useState<string | null>(null);
  const [rsvpVisible, setRsvpVisible] = useState(RSVP_PAGE);
  const [rsvpSearch, setRsvpSearch] = useState('');
  const [rsvpPending, setRsvpPending] = useState(false);
  const [availabilityTarget, setAvailabilityTarget] = useState<{
    eventId: string;
    playerId: string;
    playerName: string;
    current: Rsvp;
  } | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  useFocusEffect(() => {
    setNavigatingId(null);
  });

  // Server-side, so it searches the whole roster rather than only the pages
  // already pulled down — debounced because every distinct term is a read.
  const debouncedPlayerSearch = useDebouncedValue(playerSearch);
  // The Players tab's list: one page (50) per read, the rest on demand. On a
  // 1000-player team the full roster read below is several 200-row pages, each
  // paying can_access_athlete() per row, and this screen opens on the schedule
  // — so it is no longer on the path to anything the coach sees first.
  const rosterPages = useTeamRosterPagesQuery(id, debouncedPlayerSearch);
  // Team membership and headcount, without an athlete row per player: what the
  // tab badge, the plan's player limit and the picker's "already on this team"
  // flags actually need. One column over one statement, so it stays cheap on a
  // roster the Players tab only ever shows 50 of at a time.
  const rosterAthleteIdsQuery = useTeamRosterAthleteIdsQuery(id);
  const [addPlayersProgress, setAddPlayersProgress] = useState<{ done: number; total: number } | null>(null);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id, (done, total) => setAddPlayersProgress({ done, total }));
  const addManualPlayer = useAddManualTeamPlayerMutation(id);
  const importPlayers = useImportTeamRosterPlayersMutation(id);
  const uploadTeamPlayerPhoto = useUploadTeamPlayerPhotoMutation(id);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);
  const [removeProgress, setRemoveProgress] = useState<{ done: number; total: number } | null>(null);
  const removeRosterPlayers = useRemoveTeamRosterPlayersMutation(id, (done, total) =>
    setRemoveProgress({ done, total }),
  );
  // Which roster export is running (Options tab), so the buttons can't double-fire.
  const [exportingTeam, setExportingTeam] = useState<'xlsx' | 'pdf' | null>(null);
  // Players-tab select mode: pick several (or everyone) and remove them together.
  const [rosterSelectMode, setRosterSelectMode] = useState(false);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (tab !== 'players') {
      setRosterSelectMode(false);
      setSelectedRosterIds(new Set());
    }
  }, [tab]);
  const sendInvites = useTeamRosterInvitesMutation(id);

  // A player who never went through an assessment (no tryout roster to pull
  // them from) has no other way onto the team — this is that direct path.
  // Same AddPlayerForm the assessment roster uses, just attached to the team
  // roster instead of a tryout's participants.
  const [showAddManualPlayer, setShowAddManualPlayer] = useState(false);
  const [showImportPlayers, setShowImportPlayers] = useState(false);

  /**
   * Add a player by hand and link them to the portal, in one step — the invite
   * is the point of adding them, and making the coach save, reopen the profile
   * and invite from there was three steps to send one email.
   *
   * The player is on the roster whatever the invite does: the form closes
   * first, and the send reports itself on top of the roster. Only a bounce or
   * an address the player doesn't have is worth a dialog.
   */
  const submitManualPlayer = async (data: AddPlayerFormValues) => {
    let athleteId: string;
    try {
      ({ athleteId } = await addManualPlayer.mutateAsync(data));
      if (athleteId && data.avatarUrl && data.avatarUrl.startsWith('file://')) {
        try {
          await uploadTeamPlayerPhoto.mutateAsync({
            athleteId,
            fileUri: data.avatarUrl,
            fileType: 'image/jpeg',
          });
        } catch (e: any) {
          Alert.alert('Upload Error', 'Failed to upload profile picture: ' + e.message);
        }
      }
      setShowAddManualPlayer(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add this player.');
      return;
    }

    // No athlete id means the add reported no row to invite — a send scoped to
    // it would match nobody and report "there was nobody to invite" at a coach
    // who just saved a player.
    if (!athleteId) return;

    try {
      const result = await sendInvites.mutateAsync([athleteId]);
      if (inviteNeedsAttention(result)) {
        const { title, message } = describeInviteResult(result);
        alertMsg(title, message);
      }
    } catch (e: any) {
      alertMsg(
        'Invite Not Sent',
        `${`${data.first} ${data.last}`.trim()} was added to the roster, but the invite could not be sent: ${
          e?.message || 'Unknown error'
        }`,
      );
    }
  };

  // Events live on the season attached to this team, but that's an implementation
  // detail — the team screen is the only place a coach touches them, and the
  // season is provisioned for them.
  // Summaries, not the full seasons: all this needs is which season is attached
  // to this team, and listSeasons() assembles every season in the account —
  // every event and every roster entry joined to its athlete row — to answer
  // it. That read used to stand in front of the schedule before the season's
  // own read had even started.
  const seasonsQuery = useSeasonSummariesQuery();
  const teamSeasonId = (seasonsQuery.data ?? []).find((s) => s.teamId === id)?.id;
  const seasonQuery = useSeasonQuery(teamSeasonId);
  // Keeps RSVPs/event edits in sync with a guardian's portal without the coach
  // having to navigate away and back for the cache to refresh.
  useSeasonRealtimeSync(teamSeasonId);
  const [saveEventProgress, setSaveEventProgress] = useState<
    { phase: 'roster' | 'invites'; done: number; total: number } | null
  >(null);
  const addEvent = useAddTeamEventMutation(
    id,
    teamsQuery.data?.find((t) => t.id === id)?.name ?? 'Team',
    teamSeasonId,
    (phase, done, total) => setSaveEventProgress({ phase, done, total }),
  );
  const updateEvent = useUpdateSeasonEventMutation(teamSeasonId ?? '');
  const deleteEvent = useDeleteSeasonEventMutation(teamSeasonId ?? '');
  const setAvailability = useSetAvailabilityMutation(teamSeasonId ?? '');

  const eventForm = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Event', title: '', date: '', startTime: '', location: '', playerIds: [] },
  });
  const eventType = eventForm.watch('type');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Candidates for the "Add Players from Evaluations" picker: every athlete on
  // any assessment's roster, from ALL assessments (not just this team's),
  // deduped. Athletes already on the team are kept in the list and flagged
  // rather than hidden, so it's obvious they're accounted for instead of
  // looking like they went missing.
  // Every tryout an athlete actually appears on is tracked (not just the first
  // one seen) so filtering by assessment and "enroll everywhere" below are both
  // accurate for athletes shared across multiple assessments.
  // Memoized because this is a rescan of every roster across every assessment —
  // with dummy data counts up to 1000, redoing it on every keystroke/render
  // while the picker modal is open was visibly laggy.
  const candidates = useMemo(() => {
    const onRosterIds = new Set(rosterAthleteIdsQuery.data ?? []);
    const candidatesByAthlete = new Map<
      string,
      {
        athleteId: string;
        first: string;
        last: string;
        jersey?: string;
        pos?: string;
        yearOfBirth?: string;
        guardianEmail?: string;
        tryoutId: string;
        tryoutName: string;
        tryoutIds: Set<string>;
        tryoutNames: Set<string>;
        alreadyOnTeam: boolean;
      }
    >();
    for (const p of assessmentAthletesQuery.data ?? []) {
      const athleteId = p.athleteId;
      if (!athleteId) continue;
      const existing = candidatesByAthlete.get(athleteId);
      if (existing) {
        existing.tryoutIds.add(p.tryoutId);
        existing.tryoutNames.add(p.tryoutName);
        continue;
      }
      candidatesByAthlete.set(athleteId, {
        athleteId,
        first: p.first,
        last: p.last,
        jersey: p.jersey,
        pos: p.pos,
        yearOfBirth: p.yearOfBirth,
        guardianEmail: p.guardianEmail,
        tryoutId: p.tryoutId,
        tryoutName: p.tryoutName,
        tryoutIds: new Set([p.tryoutId]),
        tryoutNames: new Set([p.tryoutName]),
        alreadyOnTeam: onRosterIds.has(athleteId),
      });
    }
    const list = [...candidatesByAthlete.values()];
    // Already-on-team entries sink to the bottom so the actionable ones lead.
    list.sort((a, b) => Number(a.alreadyOnTeam) - Number(b.alreadyOnTeam));
    return list;
  }, [assessmentAthletesQuery.data, rosterAthleteIdsQuery.data]);

  // The rows on screen, flattened out of however many pages have been pulled
  // down. The search that used to filter this array is now part of the read
  // itself (see useTeamRosterPagesQuery), so a name that lives on page 12
  // is found without page 12 having been loaded.
  const listedPlayers = useMemo(
    () => rosterPages.data?.pages.flatMap((page) => page.players) ?? [],
    [rosterPages.data],
  );

  // "Select all" and its available-count must track the ACTIVE assessment
  // filter, not the full cross-assessment candidate pool — otherwise picking
  // one assessment's tab still selects every athlete on the account when
  // "Select all" is tapped, which is what actually produced a batch of 1001
  // instead of the one assessment's roster.
  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return candidates
      .filter((c) => !candidateTryoutFilter || c.tryoutIds.has(candidateTryoutFilter))
      .filter((c) => (q ? `${c.first} ${c.last}`.toLowerCase().includes(q) : true));
  }, [candidates, candidateTryoutFilter, candidateSearch]);

  const availableCount = useMemo(
    () => filteredCandidates.filter((c) => !c.alreadyOnTeam).length,
    [filteredCandidates],
  );

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading team..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="Team" showBack />
        <ErrorState
          message="Could not load team."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === id);
  if (!team) {
    return (
      <Screen scroll>
        <Header title="Team" showBack />
        <ErrorState message="Team not found." onRetry={() => teamsQuery.refetch()} />
      </Screen>
    );
  }

  // Mirrors the DB write policies (teams_rw, teams_manager_update): a
  // delegated manager can edit this one team regardless of their own account
  // role, and everyone else needs owner/admin/coach on the account that owns
  // it. Without this gate, an account member with a lesser role (e.g. an
  // assessor who's also a member of the account for another reason) could
  // still see the Edit button, fill out the form, and hit Save only to be
  // rejected with a raw "new row violates row-level security policy" error.
  const canEditTeam = !!team.managed || canManageTeam;

  // A manager of this team can create and run its evaluations, on the owning
  // club's plan (see effectiveTier) — their own account stays as it was. So
  // every manager, whatever role label their row carries, sees the tab.
  const canViewEvaluations = team.managed ? true : canManageTeam;

  // Every surface on this screen — background, header ink, tabs, cards — is
  // derived from the team's brand colour so the whole hub reads as the team's,
  // not just the banner. Unbranded teams get the plain theme back.
  const brand = teamBrandSurfaces(team.brandColor, colors);

  // Gates against the owning club's tier for a delegated team, not the
  // viewer's own — the club already pays for this team.
  const effectiveTier = effectiveTierForTeam(team, user?.planTier ?? 'free');
  const isAssociation = canUseFeature(effectiveTier, 'enterprise');

  /**
   * Dummy roster players write onto a linked evaluation even though this flow
   * never shows one — most freshly created teams don't have one yet, and
   * making the coach go create and attach one first just to add a few test
   * players defeated the point of a one-tap tool. So this stands a bare one
   * up on the fly the first time it's needed, the same way generateDummyTeams
   * does for brand-new teams. No rubrics: this flow only ever generates
   * unscored roster players.
   */
  const ensureDummyTryoutId = async (): Promise<string> => {
    if (dummyTryoutId) return dummyTryoutId;
    const tryout = await createDummyTryout.mutateAsync({
      name: `${team.name} Evaluation`,
      sport: 'Hockey',
      eventType: 'Tryout',
      teamId: team.id,
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) }),
      qc.invalidateQueries({ queryKey: queryKeys.tryoutSummaries(false) }),
    ]);
    return tryout.id;
  };

  const linkedTryouts = (tryoutsQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutsQuery.data ?? []).filter((t) => !t.teamId);
  const canCollectFees = canUseFeature(effectiveTier, 'payments');

  const rosterAthleteIds = rosterAthleteIdsQuery.data;
  // Falls back to what is on screen while that read is in flight, so the badge
  // and the empty-state checks never read as "no players" on a team that has
  // them.
  const playerCount = rosterAthleteIds?.length ?? listedPlayers.length;

  const isAddingPlayers = addRosterPlayers.isPending || enrollingAssessments;

  const addPickedPlayers = async () => {
    const picked = candidates.filter((c) => pickedAthletes.has(c.athleteId));
    if (picked.length === 0) return;
    // The roster lives on the owning club's account for a delegated team, so
    // its player cap is the club's, not the delegate's own — same reasoning
    // as effectiveTier everywhere else on this screen.
    if (isAtPlayerLimit(effectiveTier, playerCount + picked.length - 1)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    const entries = picked.map((c) => ({
      athleteId: c.athleteId,
      jersey: c.jersey,
      pos: c.pos,
      sourceTryoutId: c.tryoutId,
    }));
    setAddPlayersProgress({ done: 0, total: entries.length });
    try {
      await addRosterPlayers.mutateAsync(entries);

      // Keep every assessment already linked to this team in sync: enroll each
      // picked athlete there too if they aren't already a participant on it.
      if (linkedTryouts.length > 0) {
        setEnrollingAssessments(true);
        // Build the (athlete, tryout) work list first — deferred, not started —
        // then run it through a bounded worker pool below. `picked.flatMap(...
        // .map((t) => getDataSource().addPlayer(...)))` looked bounded because
        // of the `await Promise.all(...)` after it, but `.map()`'s callback
        // calls and returns the promise immediately: every addPlayer() call —
        // up to players × linked assessments — fired over the wire in the same
        // tick, well past what the connection pool or a statement timeout can
        // absorb for a large batch. Promise.all was only ever waiting on
        // requests that had already all been fired at once.
        const enrollmentTasks = picked.flatMap((c) =>
          linkedTryouts
            .filter((t) => !c.tryoutIds.has(t.id))
            .map((t) => ({
              tryoutId: t.id,
              form: {
                athleteId: c.athleteId,
                first: c.first,
                last: c.last,
                jersey: c.jersey || '',
                pos: c.pos || '',
                yearOfBirth: c.yearOfBirth || '',
                // addPlayer ignores guardian fields once athleteId is set (existing
                // athlete) — passed through only to satisfy the now-required type.
                guardianEmail: c.guardianEmail || '',
              },
            })),
        );
        if (enrollmentTasks.length > 0) {
          const ENROLLMENT_CONCURRENCY = 8;
          let nextIndex = 0;
          let completed = 0;
          setAddPlayersProgress({ done: 0, total: enrollmentTasks.length });
          const worker = async () => {
            while (nextIndex < enrollmentTasks.length) {
              const task = enrollmentTasks[nextIndex++];
              await getDataSource().addPlayer(task.tryoutId, task.form);
              completed++;
              setAddPlayersProgress({ done: completed, total: enrollmentTasks.length });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(ENROLLMENT_CONCURRENCY, enrollmentTasks.length) }, worker),
          );
          for (const t of linkedTryouts) qc.invalidateQueries({ queryKey: queryKeys.tryout(t.id) });
          qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
        }
      }

      setPickedAthletes(new Set());
      setCandidateTryoutFilter(null);
      setShowAddPlayers(false);

      // Landing on the roster is what earns the portal invite, so it goes out
      // here rather than waiting for someone to press Send Invites afterwards.
      // Only a bounce or a player with no address on file is worth a dialog — a
      // confirmation after every add is noise that trains people to dismiss
      // without reading.
      try {
        const result = await sendInvites.mutateAsync(picked.map((c) => c.athleteId));
        if (inviteNeedsAttention(result)) {
          const { title, message } = describeInviteResult(result);
          alertMsg(title, message);
        }
      } catch (e: any) {
        alertMsg(
          'Invites Not Sent',
          `The players were added to the roster, but their portal invites could not be sent: ${
            e?.message || 'Unknown error'
          }`,
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add players to the team.');
    } finally {
      setEnrollingAssessments(false);
      setAddPlayersProgress(null);
    }
  };

  const removePlayer = async (athleteId: string) => {
    try {
      await removeRosterPlayer.mutateAsync(athleteId);
    } catch (e: any) {
      // The mutation used to be fired and forgotten, so a delete the database
      // refused looked exactly like one that worked: the row vanished on the
      // optimistic update and came back on the refetch, with nothing said.
      alertMsg('Remove Failed', e?.message || 'Could not remove this player.');
    }
  };

  const confirmRemovePlayer = (athleteId: string, label: string) => {
    const message = `Remove ${label} from ${team.name}?`;
    // Alert is a no-op under React Native Web, where this app also runs — the
    // confirmation never appeared there, so the button did nothing at all.
    if (Platform.OS === 'web') {
      if (confirm(`Remove Player\n\n${message}`)) void removePlayer(athleteId);
      return;
    }
    Alert.alert('Remove Player', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removePlayer(athleteId) },
    ]);
  };

  /** Export the whole roster (not just the loaded page) as Excel or PDF. */
  const exportTeam = async (format: 'xlsx' | 'pdf') => {
    if (exportingTeam) return;
    setExportingTeam(format);
    try {
      const players = await getDataSource().listTeamRoster(team.id);
      if (players.length === 0) {
        alertMsg('Nothing to Export', 'This team has no players yet.');
        return;
      }
      const { exportTeamRosterData } = await import('@/lib/exportData');
      await exportTeamRosterData({ name: team.name, season: team.season }, players, format);
    } catch (e: any) {
      alertMsg('Export Failed', e?.message || 'Could not export the team.');
    } finally {
      setExportingTeam(null);
    }
  };

  const openEvaluationLetters = (tryoutId: string) => {
    // Full manager access from the team's own view, not the scoped-down assessor
    // mode — same reset the Evaluations tab does before opening one.
    setAssessorOnlyTryout(null);
    navigation.navigate('AssessmentFlow', {
      screen: 'AssessmentLetters',
      params: { id: tryoutId, isAssessorOnly: false },
    });
  };

  const exitRosterSelect = () => {
    setRosterSelectMode(false);
    setSelectedRosterIds(new Set());
  };

  const toggleRosterSelected = (athleteId: string) =>
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });

  // With no search running, "all" means the whole team — the ids query already
  // holds every athlete, while the list itself only ever holds the pages pulled
  // so far. With a search running it means the matches on screen.
  const selectableRosterIds =
    debouncedPlayerSearch.trim() === ''
      ? (rosterAthleteIds ?? listedPlayers.map((p) => p.athleteId))
      : listedPlayers.map((p) => p.athleteId);
  const allRosterSelected =
    selectableRosterIds.length > 0 && selectableRosterIds.every((athleteId) => selectedRosterIds.has(athleteId));

  const removeSelectedPlayers = async () => {
    const ids = [...selectedRosterIds];
    setRemoveProgress({ done: 0, total: ids.length });
    try {
      await removeRosterPlayers.mutateAsync(ids);
      exitRosterSelect();
    } catch (e: any) {
      alertMsg('Remove Failed', e?.message || 'Could not remove the selected players.');
    } finally {
      setRemoveProgress(null);
    }
  };

  const confirmRemoveSelected = () => {
    const count = selectedRosterIds.size;
    if (count === 0) return;
    const message = `${count} player${count === 1 ? '' : 's'} will be removed from ${team.name}.`;
    if (Platform.OS === 'web') {
      if (confirm(`Remove Players\n\n${message}`)) void removeSelectedPlayers();
      return;
    }
    Alert.alert('Remove Players', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeSelectedPlayers() },
    ]);
  };

  const teamSeason = seasonQuery.data;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const allTeamEvents = [...(teamSeason?.events ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const upcomingEvents = allTeamEvents.filter((e) => (e.endDate || e.date) >= todayStr);
  const pastEvents = allTeamEvents.filter((e) => (e.endDate || e.date) < todayStr);

  // Availability is stored per invited season-roster player; the coach sees it
  // as a Yes/Maybe/No tally that expands into the actual names. On a big roster
  // this is a per-event pass over every invite, and it feeds the badges on
  // every card, so it runs once per read instead of on every render.
  const rsvpByEvent = useMemo(() => {
    const byId = new Map((teamSeason?.roster ?? []).map((p) => [p.id, p]));
    const order: Rsvp[] = ['yes', 'maybe', 'no', 'pending'];
    const out = new Map<string, RsvpSummary>();
    for (const ev of teamSeason?.events ?? []) {
      const counts: Record<Rsvp, number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
      const rows: RsvpRow[] = [];
      for (const [playerId, response] of Object.entries(ev.availability ?? {})) {
        const player = byId.get(playerId);
        if (!player) continue;
        const r = (response ?? 'pending') as Rsvp;
        counts[r] += 1;
        rows.push({ playerId, name: `${player.firstName} ${player.lastName}`, response: r });
      }
      rows.sort(
        (a, b) => order.indexOf(a.response) - order.indexOf(b.response) || a.name.localeCompare(b.name),
      );
      out.set(ev.id, { counts, rows });
    }
    return out;
  }, [teamSeason?.roster, teamSeason?.events]);

  // Open the panel on the next frame so the tap paints (chevron flips, spinner
  // shows) before the rows mount, instead of the row work blocking the touch.
  const toggleRsvp = (eventId: string) => {
    const closing = openRsvpEventId === eventId;
    setRsvpVisible(RSVP_PAGE);
    setRsvpSearch('');
    setOpenRsvpEventId(closing ? null : eventId);
    if (closing) {
      setRsvpPending(false);
      return;
    }
    setRsvpPending(true);
    requestAnimationFrame(() => setRsvpPending(false));
  };

  const openEventModal = (kind: EventKind) => {
    setEditingEventId(null);
    eventForm.reset({
      type: kind,
      title: '',
      date: '',
      endDate: '',
      startTime: '',
      endTime: '',
      location: '',
      notes: '',
      playerIds: [],
    });
    setShowAddEvent(true);
  };

  const openEditEventModal = (ev: SeasonEvent) => {
    setEditingEventId(ev.id);
    eventForm.reset({
      type: ev.type,
      title: ev.title,
      date: ev.date,
      endDate: ev.endDate ?? '',
      startTime: ev.startTime ?? '',
      endTime: ev.endTime ?? '',
      location: ev.location ?? '',
      notes: ev.notes ?? '',
      playerIds: [],
    });
    setShowAddEvent(true);
  };

  const alertMsg = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  /**
   * Invite the roster to the player/guardian portal. Partial success is the
   * normal outcome — see TeamInviteResult — so the report always names what went
   * out, what bounced, and who had no address on file.
   */
  const sendRosterInvites = async () => {
    try {
      const { title, message } = describeInviteResult(await sendInvites.mutateAsync(undefined));
      alertMsg(title, message);
    } catch (e: any) {
      alertMsg('Error', e?.message || 'Could not send invites.');
    }
  };

  const confirmSendRosterInvites = () => {
    const count = playerCount;
    const message =
      `Invite all ${count} ${count === 1 ? 'player' : 'players'} on ${team.name} to the portal? ` +
      "Each invite goes to the player\u2019s own email and their guardian\u2019s, wherever those are on file.";
    if (Platform.OS === 'web') {
      if (confirm(`Send Invites\n\n${message}`)) void sendRosterInvites();
      return;
    }
    Alert.alert('Send Invites', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void sendRosterInvites() },
    ]);
  };

  const submitEvent = eventForm.handleSubmit(
    async (data) => {
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      if (new Date(y, m - 1, d, hour, min) < new Date()) {
        const msg = 'The start time you picked has already passed. Choose a date and start time that are later than now.';
        eventForm.setError('date', { type: 'manual', message: msg });
        alertMsg('Validation Error', msg);
        return;
      }
      try {
        if (editingEventId) {
          await updateEvent.mutateAsync({
            eventId: editingEventId,
            updates: {
              type: data.type,
              title: data.title,
              date: data.date,
              endDate: data.endDate || data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              location: data.location,
              notes: data.notes,
            },
          });
        } else {
          setSaveEventProgress(null);
          await addEvent.mutateAsync(data);
        }
        setShowAddEvent(false);
        setEditingEventId(null);
      } catch (e: any) {
        alertMsg('Error', e?.message || 'Could not save the event.');
      } finally {
        setSaveEventProgress(null);
      }
    },
    (errors) => {
      alertMsg(
        'Validation Error',
        errors.date?.message || errors.title?.message || 'Please check the required fields.',
      );
    },
  );

  const confirmDeleteEvent = (eventId: string, label: string) => {
    Alert.alert('Delete Event', `Delete "${label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteEvent.mutate(eventId) },
    ]);
  };

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setLogo(null);
    setCollectsFees(team.collectsFees ?? false);
    setFeeInput(team.registrationFeeCents ? (team.registrationFeeCents / 100).toFixed(2) : '');
    setBrandColor(team.brandColor ?? null);
    setEditing(true);
  };

  const handleSelectLogo = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: false,
      });
      if (result.didCancel || !result.assets?.length) return;
      
      const asset = result.assets[0];
      if (asset.uri && asset.type) {
        setLogo({ uri: asset.uri, type: asset.type });
      }
    } catch (e: any) {
      Alert.alert('Error', 'Failed to select image: ' + e.message);
    }
  };

  const save = async () => {
    let logoUrl = team.logoUrl;
    if (logo) {
      try {
        logoUrl = await uploadLogo.mutateAsync({
          teamId: team.id,
          fileUri: logo.uri,
          fileType: logo.type,
        });
      } catch (e: any) {
        Alert.alert('Logo Upload Error', 'Failed to upload logo: ' + e.message);
        return;
      }
    }
    // Only touch fee fields when the coach's plan can actually collect fees —
    // a free-tier coach never sees the toggle below, so leave whatever's
    // already stored (e.g. from before a downgrade) untouched here.
    const feeUpdates = canCollectFees
      ? collectsFees
        ? { collectsFees: true, registrationFeeCents: feeCentsFromInput(feeInput) }
        : { collectsFees: false, registrationFeeCents: 0 }
      : {};

    try {
      await updateTeam.mutateAsync({
        id: team.id,
        // '' rather than undefined when no colour is picked: undefined is "leave
        // it alone" in updateTeam's patch builder, so clearing a colour has to be
        // an explicit empty value to reach the column as NULL.
        updates: {
          name: name.trim(),
          season: season.trim() || undefined,
          logoUrl,
          brandColor: brandColor ?? '',
          ...feeUpdates,
        },
      });
    } catch (e: any) {
      // canEditTeam above hides this form from anyone who'd hit the RLS
      // check on save, but surface a readable message instead of a raw
      // Postgres error on the off chance the client's view of the team is
      // stale (e.g. a delegation just revoked from another device).
      Alert.alert('Error', e?.message || 'Could not save these changes.');
      return;
    }
    setEditing(false);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Team',
      'Are you sure you want to delete this team? This action cannot be undone and will delete all associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTeam.mutateAsync(team.id);
              navigation.replace('DashboardMain', { tab: 'teams' });
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not delete this team.');
            }
          },
        },
      ]
    );
  };

  const headerBlock = (
    <>
      <Header title={`${team.name} Hub`} showBack />

      {/* The team's own branding leads every tab, and the same banner repeats on
          the schedule/roster/player screens below it. linkToHub is off here —
          this is the hub. */}
      <TeamBanner
        team={team}
        linkToHub={false}
        className="mb-3"
        right={
          <View className="flex-row items-center gap-1">
            <ChatIconButton
              badge={<ChatUnreadBadge seasonId={teamSeasonId} />}
              onPress={() =>
                navigation.navigate('TeamChat', {
                  seasonId: teamSeasonId,
                  title: `${team.name} Chat`,
                  subtitle: team.season || undefined,
                  noSeasonMessage:
                    "This team doesn't have a season yet. Add an event under Schedule, and the chat opens for everyone on the roster and their guardians.",
                })
              }
            />
            {canEditTeam ? <Button label="Edit" variant="primary" size="sm" onPress={startEdit} /> : null}
          </View>
        }
      />

      <Tabs
        tabs={[
          { key: 'schedule', label: 'Schedule', badge: allTeamEvents.length || undefined },
          { key: 'players', label: 'Players', badge: playerCount },
          ...(canViewEvaluations ? [{ key: 'assessments', label: 'Evaluations', badge: linkedTryouts.length }] : []),
          { key: 'settings', label: 'Options' },
        ]}
        activeKey={tab}
        onChange={setTab}
        className="mt-2 mb-4"
      />
    </>
  );

  return (
    <Screen padded={false} backgroundColor={brand.screenBg}>
      {tab === 'players' ? (
        // Players can number in the hundreds (dummy data goes up to 1000), so this
        // tab renders as a virtualized FlatList instead of the plain ScrollView the
        // other tabs use — mapping that many Cards into a ScrollView mounts every
        // row at once and visibly freezes the tab switch. The header/search/add
        // controls live outside the FlatList (not in ListHeaderComponent) so they
        // stay fixed on screen instead of scrolling away with the roster.
        <View className="flex-1">
          <View className="px-4">
            {headerBlock}
            {rosterSelectMode ? (
              <View className="mb-3">
                <RosterSelectToolbar
                  allSelected={allRosterSelected}
                  count={selectedRosterIds.size}
                  deleting={removeRosterPlayers.isPending}
                  onBack={exitRosterSelect}
                  onToggleAll={() =>
                    setSelectedRosterIds(allRosterSelected ? new Set() : new Set(selectableRosterIds))
                  }
                  onDeleteSelected={confirmRemoveSelected}
                />
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2 mb-3">
                <Button
                  label="Add Players from Evaluations"
                  size="sm"
                  onPress={() => {
                    addPlayersPressAt.current = performance.now();
                    setPickedAthletes(new Set());
                    setCandidateSearch('');
                    setCandidateTryoutFilter(null);
                    setShowAddPlayers(true);
                  }}
                />
                <Button
                  label="+ Add Player Manually"
                  size="sm"
                  variant="secondary"
                  onPress={() => setShowAddManualPlayer(true)}
                />
                <Button
                  label="Import Spreadsheet"
                  size="sm"
                  variant="secondary"
                  onPress={() => setShowImportPlayers(true)}
                />
                {playerCount > 0 ? (
                  <Button
                    label="Select"
                    size="sm"
                    variant="secondary"
                    onPress={() => setRosterSelectMode(true)}
                  />
                ) : null}
                {canEditTeam && playerCount > 0 ? (
                  <Button
                    label="Send Invites"
                    size="sm"
                    variant="secondary"
                    loading={sendInvites.isPending}
                    onPress={confirmSendRosterInvites}
                  />
                ) : null}
              </View>
            )}
            {playerCount > 0 ? (
              <Input
                value={playerSearch}
                onChangeText={setPlayerSearch}
                placeholder="Search players by name"
                autoCapitalize="none"
                containerClassName="mb-3"
              />
            ) : null}
          </View>
          <FlatList
            className="flex-1 px-4"
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            data={rosterPages.isLoading ? [] : listedPlayers}
            keyExtractor={(p) => p.id}
            extraData={[navigatingId, rosterSelectMode, selectedRosterIds]}
            // See the assessment roster's list: cap how much of a large roster
            // is mounted before the first paint.
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={7}
            removeClippedSubviews
            // Scrolling to the end pulls the next 50 in on its own; the footer
            // button below is for anyone who stops short of the very bottom.
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (rosterPages.hasNextPage && !rosterPages.isFetchingNextPage) {
                void rosterPages.fetchNextPage();
              }
            }}
            ListFooterComponent={
              rosterPages.hasNextPage ? (
                <View className="pt-1 pb-3">
                  <Button
                    label={`Load ${TEAM_ROSTER_PAGE} more players`}
                    variant="secondary"
                    size="sm"
                    loading={rosterPages.isFetchingNextPage}
                    onPress={() => void rosterPages.fetchNextPage()}
                  />
                </View>
              ) : null
            }
            ListEmptyComponent={
              rosterPages.isLoading ? (
                <View className="items-center py-6 gap-2">
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading roster...</Text>
                </View>
              ) : rosterPages.isError ? (
                // Distinct from "No players yet" below: an errored fetch was
                // silently rendering as a genuinely empty roster, which reads as
                // "this team has no players" when it may well have hundreds —
                // the read just failed. Same distinction the RSVP list makes
                // above for a failed availability read.
                <Card className="items-center py-6 gap-2">
                  <Text className="font-bold" style={{ color: colors.warning }}>Couldn't load the roster</Text>
                  <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                    This team's players couldn't be loaded. They're still on the roster — reload to try again.
                  </Text>
                  <Button label="Retry" variant="secondary" size="sm" onPress={() => rosterPages.refetch()} />
                </Card>
              ) : !playerSearch.trim() ? (
                <Card className="items-center py-6 gap-1">
                  <Text className="font-bold" style={{ color: colors.ink }}>No players yet</Text>
                  <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                    Pull players in from any evaluation roster to build this team.
                  </Text>
                </Card>
              ) : (
                <Card className="items-center py-6 gap-1">
                  <Text className="font-bold" style={{ color: colors.ink }}>No matches</Text>
                  <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                    No players match "{playerSearch}".
                  </Text>
                </Card>
              )
            }
            renderItem={({ item: p }) => (
              <Pressable
                onPress={() => {
                  if (rosterSelectMode) {
                    toggleRosterSelected(p.athleteId);
                    return;
                  }
                  setNavigatingId(p.athleteId);
                  navigation.navigate('TeamPlayer', { id: team.id, playerId: p.athleteId });
                }}
                accessibilityRole="button"
                accessibilityState={rosterSelectMode ? { selected: selectedRosterIds.has(p.athleteId) } : undefined}
              >
                <Card
                  className="mb-2 flex-row items-center gap-3"
                  style={
                    rosterSelectMode && selectedRosterIds.has(p.athleteId)
                      ? { borderColor: colors.primary }
                      : undefined
                  }
                >
                  {rosterSelectMode ? (
                    // An indicator, not a nested control: the whole row toggles.
                    <View
                      className="h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border"
                      style={{
                        borderColor: selectedRosterIds.has(p.athleteId) ? colors.primary : colors.border,
                        backgroundColor: selectedRosterIds.has(p.athleteId) ? colors.primary : 'transparent',
                      }}
                    >
                      {selectedRosterIds.has(p.athleteId) ? (
                        <Text className="text-xs font-bold" style={{ color: '#fff' }}>
                          ✓
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                  <Avatar first={p.first} last={p.last} size={36} pos={p.pos} />
                  <View className="flex-1">
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {p.first} {p.last}
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {[p.jersey ? `#${p.jersey}` : null, p.pos, p.sourceTryoutName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {p.feeStatus ? (
                    <Badge
                      label={p.feeStatus === 'paid' ? 'Paid' : p.feeStatus === 'waived' ? 'Waived' : 'Unpaid'}
                      variant={p.feeStatus === 'unpaid' ? 'warning' : 'success'}
                    />
                  ) : null}
                  {rosterSelectMode ? null : navigatingId === p.athleteId ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Button
                      label="Remove"
                      size="sm"
                      variant="ghost"
                      loading={removeRosterPlayer.isPending && removeRosterPlayer.variables === p.athleteId}
                      onPress={() => confirmRemovePlayer(p.athleteId, `${p.first} ${p.last}`)}
                    />
                  )}
                </Card>
              </Pressable>
            )}
          />
        </View>
      ) : tab === 'assessments' && canViewEvaluations ? (
        // Same rationale as the Players tab: an association could have many linked
        // assessments, so this scrolls as a virtualized FlatList with the
        // header/actions fixed above it rather than scrolling away.
        <View className="flex-1">
          <View className="px-4">
            {headerBlock}
            <View className="flex-row gap-2 mb-3">
              <Button
                label="Create"
                size="sm"
                className="flex-1"
                onPress={() => navigation.navigate('NewAssessment', { teamId: team.id })}
              />
              <Button
                label="Attach Existing"
                variant="secondary"
                size="sm"
                className="flex-1"
                onPress={() => setShowAttachModal(true)}
              />
            </View>
          </View>
          <FlatList
            className="flex-1 px-4"
            contentContainerStyle={{ paddingBottom: 24 }}
            data={linkedTryouts}
            keyExtractor={(t) => t.id}
            extraData={navigatingId}
            ListEmptyComponent={
              <Card className="items-center py-6 gap-1">
                <Text className="font-bold" style={{ color: colors.ink }}>No evaluations linked</Text>
                <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                  Create a tryout or evaluation for this team, or attach one you already have.
                </Text>
              </Card>
            }
            renderItem={({ item: t }) => (
              <Pressable
                onPress={() => {
                  setNavigatingId(t.id);
                  // Opening a linked evaluation from the team's own manager
                  // view is full manager access, not the scoped-down
                  // assessor mode — clear any stale flag left over from a
                  // previous "Assigned Evaluations" visit to this same
                  // tryout, or Tools items like Letters stay hidden even
                  // though this user has full access. See useAssessorMode.
                  setAssessorOnlyTryout(null);
                  navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: t.id } });
                }}
              >
                <Card className="mb-2 flex-row items-center justify-between">
                  <View className="flex-1 pr-2">
                    <Text className="font-bold" style={{ color: colors.ink }}>{t.name}</Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {t.sport} · {t.eventType} · {t.playerCount} players
                    </Text>
                  </View>
                  {navigatingId === t.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Badge label="Open" variant="brand" />
                  )}
                </Card>
              </Pressable>
            )}
          />
        </View>
      ) : (
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {headerBlock}

        {tab === 'schedule' ? (
          <PlanGate feature="seasonHub" title="Season Hub" tierOverride={effectiveTier}>
          <View>
            <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
              Season Hub
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              <Button label="+ Event" size="sm" onPress={() => openEventModal('Event')} />
            </View>

            {seasonsQuery.isLoading || (teamSeasonId ? seasonQuery.isLoading : false) ? (
              <View className="items-center py-6 gap-2">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading events...</Text>
              </View>
            ) : allTeamEvents.length === 0 ? (
              <Card className="items-center py-6 gap-1">
                <Text className="font-bold" style={{ color: colors.ink }}>No upcoming events</Text>
                <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                  Add an event — everyone on the roster is invited and their guardians can RSVP from
                  the portal.
                </Text>
              </Card>
            ) : (
              allTeamEvents.map((ev) => {
                const rsvp = rsvpByEvent.get(ev.id) ?? EMPTY_RSVP;
                const expanded = openRsvpEventId === ev.id;
                // Only the open card pays for filtering/slicing its roster.
                const q = expanded ? rsvpSearch.trim().toLowerCase() : '';
                const matchedRows = !expanded
                  ? EMPTY_RSVP.rows
                  : q
                    ? rsvp.rows.filter((r) => r.name.toLowerCase().includes(q))
                    : rsvp.rows;
                const shownRows = expanded ? matchedRows.slice(0, rsvpVisible) : EMPTY_RSVP.rows;
                const remaining = matchedRows.length - shownRows.length;
                return (
                  <Card key={ev.id} className="mb-3 gap-2">
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <Text className="font-bold text-base" style={{ color: colors.ink }}>
                          {ev.date}
                          {ev.startTime ? ` · ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : ''}
                          {ev.location ? (
                            <>
                              {' · '}
                              <MapLink location={ev.location} label={ev.title} variant="inline" />
                            </>
                          ) : null}
                        </Text>
                        <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                          {ev.title}
                        </Text>
                      </View>
                      <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
                    </View>

                    {/* The event lands a round trip or two before its RSVPs do
                        (see getSeason's staged read) — a tally of zeroes in the
                        meantime would read as "nobody answered". */}
                    {ev.availabilityPending ? (
                      <View className="flex-row items-center gap-2 py-1">
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading RSVPs...</Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center gap-2 py-1 flex-wrap">
                        <Badge label={`${rsvp.counts.yes} yes`} variant="success" size="lg" />
                        <Badge label={`${rsvp.counts.maybe} maybe`} variant="warning" size="lg" />
                        <Badge label={`${rsvp.counts.no} no`} variant="danger" size="lg" />
                        {rsvp.counts.pending > 0 ? (
                          <Badge label={`${rsvp.counts.pending} pending`} variant="info" size="lg" />
                        ) : null}
                      </View>
                    )}

                    <Pressable
                      onPress={() => toggleRsvp(ev.id)}
                      className="flex-row items-center justify-between rounded-md px-3 py-2.5 border"
                      style={{
                        backgroundColor: expanded ? colors.tile : 'rgba(255,107,43,0.08)',
                        borderColor: colors.primary,
                      }}
                      hitSlop={6}
                    >
                      <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                        {expanded ? 'Hide RSVPs' : 'Who’s coming? Set RSVPs'}
                      </Text>
                      {expanded && rsvpPending ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={{ color: colors.primary, fontSize: 14 }}>{expanded ? '▴' : '▾'}</Text>
                      )}
                    </Pressable>

                    {expanded ? (
                      <View className="rounded-md border overflow-hidden" style={{ borderColor: colors.border }}>
                        {rsvpPending || ev.availabilityPending ? (
                          <View className="items-center py-6 gap-2">
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading RSVPs...</Text>
                          </View>
                        ) : rsvp.rows.length === 0 && ev.availabilityUnavailable ? (
                          <Text className="text-xs p-3" style={{ color: colors.warning }}>
                            RSVPs couldn’t be loaded for this event. Everyone invited is still invited —
                            reload to try again.
                          </Text>
                        ) : rsvp.rows.length === 0 ? (
                          <Text className="text-xs p-3" style={{ color: colors.inkMuted }}>
                            Nobody was invited to this event yet.
                          </Text>
                        ) : (
                          <>
                            <Text
                              className="text-xs px-3 py-2"
                              style={{ color: colors.inkMuted, backgroundColor: colors.tile }}
                            >
                              Tap a player to set their RSVP
                              {rsvp.rows.length > RSVP_PAGE ? ` · ${rsvp.rows.length} invited` : ''}
                            </Text>
                            {rsvp.rows.length > RSVP_PAGE ? (
                              <View className="px-3 pt-2">
                                <Input
                                  value={rsvpSearch}
                                  onChangeText={(t) => {
                                    setRsvpSearch(t);
                                    setRsvpVisible(RSVP_PAGE);
                                  }}
                                  placeholder="Search players by name"
                                  autoCapitalize="none"
                                />
                              </View>
                            ) : null}
                            {shownRows.length === 0 ? (
                              <Text className="text-xs p-3" style={{ color: colors.inkMuted }}>
                                No players match "{rsvpSearch}".
                              </Text>
                            ) : null}
                            {shownRows.map((r, i) => (
                              <Pressable
                                key={r.playerId}
                                onPress={() =>
                                  setAvailabilityTarget({
                                    eventId: ev.id,
                                    playerId: r.playerId,
                                    playerName: r.name,
                                    current: r.response,
                                  })
                                }
                                className="flex-row items-center justify-between px-3 py-3"
                                style={{
                                  borderTopWidth: i === 0 ? 0 : 1,
                                  borderTopColor: colors.border,
                                }}
                              >
                                <Text className="text-base flex-1 pr-2 font-bold" style={{ color: colors.ink }}>
                                  {r.name}
                                </Text>
                                <View className="flex-row items-center gap-1.5">
                                  <Badge label={RSVP_LABEL[r.response]} variant={RSVP_VARIANT[r.response]} size="lg" />
                                  <Text style={{ color: colors.inkFaint, fontSize: 13 }}>›</Text>
                                </View>
                              </Pressable>
                            ))}
                            {remaining > 0 ? (
                              <Pressable
                                onPress={() => setRsvpVisible((v) => v + RSVP_PAGE * 2)}
                                className="px-3 py-3 items-center"
                                style={{ borderTopWidth: 1, borderTopColor: colors.border }}
                              >
                                <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                                  Show {Math.min(remaining, RSVP_PAGE * 2)} more ({remaining} left)
                                </Text>
                              </Pressable>
                            ) : null}
                          </>
                        )}
                      </View>
                    ) : null}

                    <View className="flex-row flex-wrap gap-2 items-center">
                      {/* No size="sm" here: Button's own text stays text-base at every
                          size (see Button.tsx), so its "sm" already renders taller than
                          MapLink's text-xs "sm" chip. MapLink's default (md) size lands
                          at the same actual height as Button's "sm" — this is the match,
                          not a mismatch to fix later. */}
                      <AddToCalendar event={ev} teamName={team.name} />
                      <MapLink location={ev.location} label={ev.title} />
                      <Button label="Edit" variant="secondary" size="sm" onPress={() => openEditEventModal(ev)} />
                      <Button
                        label="Delete"
                        variant="danger"
                        size="sm"
                        loading={deleteEvent.isPending && deleteEvent.variables === ev.id}
                        onPress={() => confirmDeleteEvent(ev.id, ev.title)}
                      />
                    </View>
                  </Card>
                );
              })
            )}
          </View>
          </PlanGate>
        ) : (
          <View>
            {/* CLUB mode: hand this one team to another coach/manager. A
                delegate of this team can now manage the list too (see
                can_delegate_team() in 20260827120000_team_manager_full_access.sql) —
                readOnly no longer applies to a viewer who reached this screen
                as this team's own manager. */}
            <View className="mb-3">
              <TeamManagersCard
                teamId={team.id}
                teamName={team.name}
                tierOverride={effectiveTier}
              />
            </View>

            <Card className="mb-3 gap-2">
              <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Export Team
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Download the full roster with jersey, position, year of birth, and player and guardian contact
                details. Medical information is not included.
              </Text>
              <View className="flex-row flex-wrap gap-2 mt-1">
                <Button
                  label="Excel"
                  size="sm"
                  variant="secondary"
                  loading={exportingTeam === 'xlsx'}
                  disabled={exportingTeam !== null}
                  onPress={() => exportTeam('xlsx')}
                />
                <Button
                  label="PDF"
                  size="sm"
                  variant="secondary"
                  loading={exportingTeam === 'pdf'}
                  disabled={exportingTeam !== null}
                  onPress={() => exportTeam('pdf')}
                />
              </View>
            </Card>

            {canViewEvaluations ? (
              <Card className="mb-3 gap-3">
                <View className="gap-1">
                  <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                    Player Selection Letters
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    The Offer Letter (made the team) and the Roster Decision Letter (not selected). Write and
                    edit them here.
                  </Text>
                </View>
                <LetterTemplatesManager />
                <View className="gap-2">
                  <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                    Send letters
                  </Text>
                  {linkedTryouts.length === 0 ? (
                    <Text className="text-xs" style={{ color: colors.inkFaint }}>
                      Sending is done from an evaluation. No evaluations are linked to this team yet — create or
                      attach one on the Evaluations tab.
                    </Text>
                  ) : (
                    <>
                      <Text className="text-xs" style={{ color: colors.inkMuted }}>
                        Choose the players and send from the evaluation:
                      </Text>
                      {linkedTryouts.map((t) => (
                        <Button
                          key={t.id}
                          label={t.name}
                          size="sm"
                          variant="secondary"
                          onPress={() => openEvaluationLetters(t.id)}
                        />
                      ))}
                    </>
                  )}
                </View>
              </Card>
            ) : null}

            {isAssociation ? (
              <Card className="mb-3 gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Dummy Data
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Add a batch of realistic dummy players straight to this team&apos;s roster.
                </Text>
                <View className="flex-row flex-wrap gap-2 mt-1">
                  <Button
                    label="Add Dummy Players"
                    size="sm"
                    loading={preparingDummyTryout}
                    onPress={async () => {
                      setPreparingDummyTryout(true);
                      try {
                        await ensureDummyTryoutId();
                        setShowTestGen(true);
                      } catch (e: any) {
                        const msg = e?.message || 'Failed to prepare an evaluation.';
                        if (Platform.OS === 'web') alert(msg);
                        else Alert.alert('Error', msg);
                      } finally {
                        setPreparingDummyTryout(false);
                      }
                    }}
                  />
                  {dummyTryoutId ? (
                    <Button
                      label="Clear Dummy Data"
                      size="sm"
                      variant="ghost"
                      loading={clearTest.isPending}
                      onPress={async () => {
                        try {
                          const res = await clearTest.mutateAsync();
                          const msg = `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`;
                          if (Platform.OS === 'web') alert(msg);
                          else Alert.alert('Cleared', msg);
                        } catch (e: any) {
                          const msg = e?.message || 'Failed to clear dummy data.';
                          if (Platform.OS === 'web') alert(msg);
                          else Alert.alert('Error', msg);
                        }
                      }}
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}

            {/* A delegated manager runs the team but doesn't own it — deleting
                the club's team isn't theirs to do, and the teams RLS grants
                them update but not delete, so the button would only ever fail. */}
            {team.managed ? null : (
              <Card className="gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.danger }}>
                  Danger Zone
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Deleting a team removes its roster, schedule, and links to evaluations.
                </Text>
                <Button label="Delete Team" variant="danger" size="sm" onPress={handleDelete} loading={deleteTeam.isPending} />
              </Card>
            )}
          </View>
        )}
      </ScrollView>
      )}

      <Modal visible={editing} title="Edit Team" onClose={() => setEditing(false)}>
        <View className="gap-3">
          <Pressable onPress={handleSelectLogo} className="items-center mb-2 mt-4">
            <View className="mb-3">
              <Avatar
                uri={logo?.uri || team?.logoUrl}
                first="T"
                last="M"
                size={80}
              />
            </View>
            <Text className="font-bold text-sm" style={{ color: colors.primary }}>
              Change Team Logo
            </Text>
          </Pressable>
          <Input label="Team name" value={name} onChangeText={setName} />
          <Input label="Season" value={season} onChangeText={setSeason} />

          <TeamColorPicker value={brandColor} onChange={setBrandColor} />

          {canCollectFees ? (
            <>
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Are you collecting fees?
                </Text>
                <View className="flex-row gap-2">
                  <Chip label="No" active={!collectsFees} onPress={() => setCollectsFees(false)} />
                  <Chip label="Yes" active={collectsFees} onPress={() => setCollectsFees(true)} />
                </View>
              </View>

              {collectsFees ? (
                <Card className="gap-2">
                  <Input
                    label="Fee per player (CAD)"
                    value={feeInput}
                    onChangeText={setFeeInput}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                  />
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Saving this creates (or reuses) this team's season and adds everyone currently on
                    the roster to it — each player's guardian will then be asked to pay this fee, plus
                    TryoutHQ's 0.5% platform fee, from their portal.
                  </Text>
                </Card>
              ) : null}
            </>
          ) : null}

          <Button label="Save Changes" onPress={save} loading={updateTeam.isPending || uploadLogo.isPending} />
        </View>
      </Modal>

      <Modal
        visible={showAttachModal}
        title="Attach Evaluation"
        onClose={() => {
          if (updateTryout.isPending) return;
          setShowAttachModal(false);
        }}
      >
        <View style={{ gap: 2 }}>
          {unlinkedTryouts.length === 0 ? (
            <Text style={{ color: colors.inkMuted, padding: 12 }}>No evaluations available to link.</Text>
          ) : (
            unlinkedTryouts.map((t) => {
              const isAttaching = updateTryout.isPending && updateTryout.variables?.id === t.id;
              return (
              <Pressable
                key={t.id}
                disabled={updateTryout.isPending}
                onPress={async () => {
                  try {
                    await updateTryout.mutateAsync({ id: t.id, updates: { teamId: team.id } });
                    setShowAttachModal(false);
                  } catch (e: any) {
                    Alert.alert('Error', e.message || 'Could not link evaluation.');
                  }
                }}
                style={({ pressed }) => [
                  {
                    padding: 12,
                    backgroundColor: pressed ? colors.border : 'transparent',
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    opacity: updateTryout.isPending && !isAttaching ? 0.5 : 1,
                  }
                ]}
              >
                <Text className="font-bold" style={{ color: colors.ink }}>{t.name}</Text>
                <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
                  {isAttaching ? 'Attaching...' : `${t.sport} · ${t.playerCount} players`}
                </Text>
              </Pressable>
              );
            })
          )}
        </View>
      </Modal>

      <Modal
        visible={showAddPlayers}
        title="Add Players from Evaluations"
        scroll={false}
        onClose={() => {
          if (isAddingPlayers) return;
          setShowAddPlayers(false);
        }}
        footer={
          <View className="mt-4" style={{ gap: 8 }}>
            {isAddingPlayers && addPlayersProgress && addPlayersProgress.total > 0 ? (
              <View style={{ gap: 4 }}>
                <View
                  style={{
                    width: '100%',
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    backgroundColor: colors.tile,
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(100, Math.max(4, Math.round((addPlayersProgress.done / addPlayersProgress.total) * 100)))}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
                  Added {addPlayersProgress.done} of {addPlayersProgress.total} players...
                </Text>
              </View>
            ) : null}
            <Button
              label={pickedAthletes.size === 0 ? 'Select players to add' : `Add ${pickedAthletes.size} to ${team.name}`}
              disabled={pickedAthletes.size === 0 || isAddingPlayers}
              loading={isAddingPlayers}
              onPress={addPickedPlayers}
            />
          </View>
        }
      >
        {!showAddPlayers ? null : isAddingPlayers ? (
          <LoadingState
            message={
              addPlayersProgress && addPlayersProgress.total > 0
                ? `Added ${addPlayersProgress.done} of ${addPlayersProgress.total} players...`
                : 'Adding players...'
            }
          />
        ) : assessmentAthletesQuery.isLoading || rosterAthleteIdsQuery.isLoading ? (
          // The candidate list's read only starts when this panel opens, so it
          // has its own wait — without this the picker would flash "no
          // assessments have players yet" every time before the rosters land.
          // The team's own membership is read alongside it, and waiting for
          // that is what keeps the "already on this team" flags (and the
          // plan-limit check behind the Add button) from being computed
          // against nobody.
          <LoadingState message="Loading players..." />
        ) : assessmentAthletesQuery.isError ? (
          <Text className="text-sm py-3" style={{ color: colors.inkMuted }}>
            Could not load players. Close and reopen to try again.
          </Text>
        ) : candidates.length === 0 ? (
          <Text className="text-sm py-3" style={{ color: colors.inkMuted }}>
            No evaluations have players yet — add players to an evaluation roster first.
          </Text>
        ) : (
          <View className="flex-1">
            <Input
              value={candidateSearch}
              onChangeText={setCandidateSearch}
              placeholder="Search players by name"
              autoCapitalize="none"
              containerClassName="mb-3"
            />
            {linkedTryouts.length > 0 ? (
              <View className="flex-row flex-wrap gap-2 mb-3">
                <Chip
                  label="All"
                  active={candidateTryoutFilter === null}
                  onPress={() => setCandidateTryoutFilter(null)}
                />
                {linkedTryouts.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    active={candidateTryoutFilter === t.id}
                    onPress={() => setCandidateTryoutFilter(candidateTryoutFilter === t.id ? null : t.id)}
                  />
                ))}
              </View>
            ) : null}
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-xs flex-1 pr-2" style={{ color: colors.inkMuted }}>
                Athletes from all of your evaluations. Tap to select.
              </Text>
              {availableCount > 0 ? (
                <Pressable
                  onPress={() =>
                    setPickedAthletes((prev) =>
                      prev.size === availableCount
                        ? new Set()
                        : new Set(filteredCandidates.filter((c) => !c.alreadyOnTeam).map((c) => c.athleteId)),
                    )
                  }
                  hitSlop={8}
                >
                  <Text className="text-xs font-bold" style={{ color: colors.primary }}>
                    {pickedAthletes.size === availableCount ? 'Clear all' : 'Select all'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <FlatList
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              data={filteredCandidates}
              keyExtractor={(c) => c.athleteId}
              ListEmptyComponent={
                <Text className="text-sm text-center py-4" style={{ color: colors.inkMuted }}>
                  No players match "{candidateSearch}".
                </Text>
              }
              renderItem={({ item: c }) => {
                const picked = pickedAthletes.has(c.athleteId);
                return (
                  <Pressable
                    disabled={c.alreadyOnTeam}
                    onPress={() =>
                      setPickedAthletes((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.athleteId)) next.delete(c.athleteId);
                        else next.add(c.athleteId);
                        return next;
                      })
                    }
                    className="flex-row items-center gap-3 py-3 px-2 rounded-md border mb-2"
                    style={{
                      borderColor: picked ? colors.primary : colors.border,
                      backgroundColor: picked ? 'rgba(255,107,43,0.12)' : 'transparent',
                      opacity: c.alreadyOnTeam ? 0.5 : 1,
                    }}
                  >
                    <Avatar first={c.first} last={c.last} size={32} pos={c.pos} />
                    <View className="flex-1">
                      <Text className="font-bold" style={{ color: colors.ink }}>
                        {c.first} {c.last}
                      </Text>
                      <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                        {[c.jersey ? `#${c.jersey}` : null, c.pos, [...c.tryoutNames].join(', ')]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {c.alreadyOnTeam ? (
                      <Badge label="On Team" variant="success" />
                    ) : picked ? (
                      <Badge label="Selected" variant="brand" />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        )}
      </Modal>

      <DeleteProgressModal visible={removeRosterPlayers.isPending} progress={removeProgress} noun="players" />

      <ImportPlayersModal
        visible={showImportPlayers}
        onClose={() => setShowImportPlayers(false)}
        target={team.name}
        onImport={async (rows, onProgress) => {
          const result = await importPlayers.mutateAsync({ rows, onProgress });
          // Same rule as every other way onto this roster: the import is what
          // earns the portal invite. Scoped to the athletes the import actually
          // landed, so a re-import doesn't re-mail the players already there.
          //
          // No dialog on the way out, unlike the other add paths: the modal
          // shows its own per-row import summary the moment this returns, and a
          // second dialog in front of it — "no email on file for these four" —
          // buries the one the coach is waiting for. A player the invite
          // couldn't reach already reads as "No invite" on the roster.
          if (result.athleteIds?.length) {
            try {
              await sendInvites.mutateAsync(result.athleteIds);
            } catch (e) {
              console.warn('Portal invites failed after a roster import:', e);
            }
          }
          return result;
        }}
      />

      <Modal
        visible={showAddManualPlayer}
        title="Add Player Manually"
        onClose={() => {
          if (addManualPlayer.isPending || uploadTeamPlayerPhoto.isPending) return;
          setShowAddManualPlayer(false);
        }}
      >
        <AddPlayerForm
          loading={addManualPlayer.isPending || uploadTeamPlayerPhoto.isPending || sendInvites.isPending}
          onSubmit={submitManualPlayer}
          submitLabel="Save Player & Send Invite"
        />
      </Modal>

      <Modal
        visible={showAddEvent}
        title={editingEventId ? `Edit ${eventType}` : `Add ${eventType}`}
        onClose={() => {
          setShowAddEvent(false);
          setEditingEventId(null);
        }}
      >
        <View className="gap-3">
          <Controller
            control={eventForm.control}
            name="title"
            render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
              <Input label="Title" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
            )}
          />
          <Controller
            control={eventForm.control}
            name="date"
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <DateField label="Start Date" value={value} onChange={onChange} placeholder="Select a date" error={error?.message} disablePast />
            )}
          />
          <Controller
            control={eventForm.control}
            name="endDate"
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <DateField
                label="End Date (optional)"
                value={value}
                onChange={onChange}
                placeholder="Same as start date"
                error={error?.message}
                disablePast
                minDate={eventForm.watch('date') || undefined}
              />
            )}
          />
          <Controller
            control={eventForm.control}
            name="startTime"
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <TimeField label="Start Time" value={value} onChange={onChange} placeholder="Select a time" error={error?.message} disablePast dateValue={eventForm.watch('date')} />
            )}
          />
          <Controller
            control={eventForm.control}
            name="endTime"
            render={({ field: { onChange, value }, fieldState: { error } }) => (
              <TimeField label="End Time" value={value} onChange={onChange} placeholder="Select a time" error={error?.message} />
            )}
          />
          <Controller
            control={eventForm.control}
            name="location"
            render={({ field: { onChange, onBlur, value } }) => (
              <View>
                <Input
                  label="Location"
                  placeholder="Venue and street address"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
                <MapLocationHint location={value} />
              </View>
            )}
          />
          {editingEventId ? null : (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Everyone on the roster is invited by default.
            </Text>
          )}
          {/* Shown for the whole save, not just once a (done, total) has
              arrived: enrolling a large roster and writing its invites are two
              serial phases, and the gap before the first progress event used to
              leave nothing on screen but the button spinner. */}
          {addEvent.isPending ? (
            <View style={{ gap: 4 }}>
              <View
                style={{
                  width: '100%',
                  height: 8,
                  borderRadius: 999,
                  overflow: 'hidden',
                  backgroundColor: colors.tile,
                }}
              >
                <View
                  style={{
                    width:
                      saveEventProgress && saveEventProgress.total > 0
                        ? `${Math.min(100, Math.max(4, Math.round((saveEventProgress.done / saveEventProgress.total) * 100)))}%`
                        : '4%',
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
              <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
                {!saveEventProgress
                  ? 'Saving event...'
                  : saveEventProgress.total === 0
                    ? saveEventProgress.done > 0
                      ? // total: 0 with a nonzero count is the "still scanning
                        // linked assessments, don't know the total yet" state
                        // (see importSeasonPlayersFromTeam) — surfacing the
                        // running count is what keeps this from reading as
                        // frozen on a big roster, even without a fraction.
                        //
                        // "entries", not "players": this counts participant
                        // rows across every assessment linked to the team, so
                        // an athlete who tried out three times is three of
                        // them, and rows for cut players are still in the scan
                        // (they're filtered after it). Calling those players
                        // put a number on screen that was always higher than
                        // the roster the coach ended up with.
                        `Checking ${saveEventProgress.done} evaluation entries so far...`
                      : 'Saving event...'
                    : saveEventProgress.phase === 'roster'
                      ? // This count is every athlete across the team's linked assessments
                        // being synced onto the season roster for other features (see
                        // syncSeasonRosterFromTeam) — it is not who the event invites, and on
                        // a team with large attached assessments it can run well past the
                        // team's actual headcount. Only the 'invites' phase below reflects
                        // who actually gets this event.
                        `Syncing ${saveEventProgress.done} of ${saveEventProgress.total} evaluation records...`
                      : `Sending invites to ${saveEventProgress.done} of ${saveEventProgress.total} players...`}
              </Text>
            </View>
          ) : null}
          <Button
            label={editingEventId ? 'Update Event' : 'Save Event'}
            onPress={submitEvent}
            loading={addEvent.isPending || updateEvent.isPending}
          />
        </View>
      </Modal>

      <Modal
        visible={!!availabilityTarget}
        title={availabilityTarget?.playerName ?? 'Availability'}
        onClose={() => setAvailabilityTarget(null)}
      >
        <View className="gap-2">
          <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
            Set this player's availability for the event. This overrides whatever they (or their guardian) submitted.
          </Text>
          {(['yes', 'maybe', 'no'] as const).map((option) => (
            <Button
              key={option}
              label={RSVP_LABEL[option]}
              variant={availabilityTarget?.current === option ? 'primary' : 'secondary'}
              loading={setAvailability.isPending}
              onPress={async () => {
                if (!availabilityTarget) return;
                try {
                  await setAvailability.mutateAsync({
                    eventId: availabilityTarget.eventId,
                    playerId: availabilityTarget.playerId,
                    response: option,
                  });
                  setAvailabilityTarget(null);
                } catch (e: any) {
                  Alert.alert('Error', e?.message || 'Could not update availability.');
                }
              }}
            />
          ))}
        </View>
      </Modal>

      <Modal
        visible={showTestGen}
        title="Add Dummy Players"
        onClose={() => setShowTestGen(false)}
        footer={
          <View className="mt-4" style={{ gap: 8 }}>
            {genTest.isPending && dummyProgress && dummyProgress.total > 0 ? (
              <View style={{ gap: 4 }}>
                <View
                  style={{
                    width: '100%',
                    height: 8,
                    borderRadius: 999,
                    overflow: 'hidden',
                    backgroundColor: colors.tile,
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(100, Math.max(4, Math.round((dummyProgress.done / dummyProgress.total) * 100)))}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
                  Adding {dummyProgress.done} of {dummyProgress.total} players...
                </Text>
              </View>
            ) : null}
            <Button
              label={`Add ${clampOption(dummyPlayerCount, DUMMY_LIMITS.count, 25)} Players`}
              loading={genTest.isPending || addRosterPlayers.isPending}
              onPress={async () => {
                setDummyProgress(null);
                try {
                  const tryoutIdForRoster = await ensureDummyTryoutId();
                  const res = await genTest.mutateAsync({
                    target: 'roster',
                    count: clampOption(dummyPlayerCount, DUMMY_LIMITS.count, 25),
                    withScores: false,
                    sessionsPerPlayer: 1,
                  });
                  // generateTestData only writes onto the evaluation's own roster —
                  // this screen is the team's, so the same athletes still have to
                  // land on team_roster before the Players tab will show them.
                  if (res.athleteIds?.length) {
                    await addRosterPlayers.mutateAsync(
                      res.athleteIds.map((athleteId) => ({ athleteId, sourceTryoutId: tryoutIdForRoster })),
                    );
                  }
                  const msg = `Added ${res.players} players to the roster.`;
                  if (Platform.OS === 'web') alert(msg);
                  else Alert.alert('Dummy players added', msg);
                } catch (e: any) {
                  const msg = e?.message || 'Failed to add dummy players.';
                  if (Platform.OS === 'web') alert(msg);
                  else Alert.alert('Error', msg);
                } finally {
                  setShowTestGen(false);
                  setDummyProgress(null);
                }
              }}
            />
          </View>
        }
      >
        <Input
          label={`How many players (${DUMMY_LIMITS.count.min}–${DUMMY_LIMITS.count.max})`}
          value={dummyPlayerCount}
          onChangeText={setDummyPlayerCount}
          keyboardType="number-pad"
          placeholder="25"
        />
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />

      <BottomNav active="teams" />
    </Screen>
  );
}
