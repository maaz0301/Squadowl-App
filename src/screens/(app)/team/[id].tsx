import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, Alert, Pressable, Platform, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, Chip, DateField, ErrorState, Header, Input, LoadingState, Modal, Screen, Tabs, TimeField } from '@/components/ui';
import { useTeamsQuery, useTryoutsQuery, useUpdateTeamMutation, useDeleteTeamMutation, useUpdateTryoutMutation, useGenerateTestDataMutation, useClearTestDataMutation, useTeamRosterQuery, useAddTeamRosterPlayersMutation, useRemoveTeamRosterPlayerMutation, useSeasonsQuery, useSeasonQuery, useSeasonRealtimeSync, useAddTeamEventMutation, useUpdateSeasonEventMutation, useDeleteSeasonEventMutation, useUploadTeamLogoMutation, useSetAvailabilityMutation } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm, type EventKind, type SeasonEvent } from '@/data/types';
import { BottomNav } from '@/components/BottomNav';
import { ChatIconButton } from '@/components/ChatIconButton';
import { PlanGate } from '@/components/PlanGate';
import { DummyDataModal } from '@/components/DummyDataModal';
import type { DummyDataOptions } from '@/data/testDataGenerator';
import { getDataSource } from '@/data';
import { queryKeys } from '@/lib/queryClient';

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

export default function TeamDetailScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const qc = useQueryClient();
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const updateTryout = useUpdateTryoutMutation();
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const canCollectFees = canUseFeature(user?.planTier ?? 'free', 'payments');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showDummy, setShowDummy] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
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
  const [tab, setTab] = useState('schedule');
  const [openRsvpEventId, setOpenRsvpEventId] = useState<string | null>(null);
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

  const rosterQuery = useTeamRosterQuery(id);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);

  // Events live on the season attached to this team, but that's an implementation
  // detail — the team screen is the only place a coach touches them, and the
  // season is provisioned for them.
  const seasonsQuery = useSeasonsQuery();
  const teamSeasonId = (seasonsQuery.data ?? []).find((s) => s.teamId === id)?.id;
  const seasonQuery = useSeasonQuery(teamSeasonId);
  // Keeps RSVPs/event edits in sync with a guardian's portal without the coach
  // having to navigate away and back for the cache to refresh.
  useSeasonRealtimeSync(teamSeasonId);
  const addEvent = useAddTeamEventMutation(
    id,
    teamsQuery.data?.find((t) => t.id === id)?.name ?? 'Team',
    teamSeasonId,
  );
  const updateEvent = useUpdateSeasonEventMutation(teamSeasonId ?? '');
  const deleteEvent = useDeleteSeasonEventMutation(teamSeasonId ?? '');
  const setAvailability = useSetAvailabilityMutation(teamSeasonId ?? '');

  const eventForm = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '', playerIds: [] },
  });
  const eventType = eventForm.watch('type');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // A team has no roster table of its own — its players are the participants of
  // the assessments linked to it. Resolve the target assessment before the early
  // returns below so these hooks stay unconditional.
  const linkedForHooks = (tryoutsQuery.data ?? []).filter((t) => t.teamId === id);
  const dummyTarget = linkedForHooks[0];
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(dummyTarget?.id ?? '', (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(dummyTarget?.id ?? '');

  // Candidates for the "Add Players from Assessments" picker: every athlete on
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
    const onRosterIds = new Set((rosterQuery.data ?? []).map((p) => p.athleteId));
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
    for (const t of tryoutsQuery.data ?? []) {
      for (const p of t.roster ?? []) {
        const athleteId = p.athleteId;
        if (!athleteId) continue;
        const existing = candidatesByAthlete.get(athleteId);
        if (existing) {
          existing.tryoutIds.add(t.id);
          existing.tryoutNames.add(t.name);
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
          tryoutId: t.id,
          tryoutName: t.name,
          tryoutIds: new Set([t.id]),
          tryoutNames: new Set([t.name]),
          alreadyOnTeam: onRosterIds.has(athleteId),
        });
      }
    }
    const list = [...candidatesByAthlete.values()];
    // Already-on-team entries sink to the bottom so the actionable ones lead.
    list.sort((a, b) => Number(a.alreadyOnTeam) - Number(b.alreadyOnTeam));
    return list;
  }, [tryoutsQuery.data, rosterQuery.data]);

  // Same reasoning as `candidates` above: these are recomputed on every render
  // of the screen (RSVP taps, unrelated form edits, etc.), not just when their
  // own inputs change, so with hundreds of players that was wasted work on
  // every keystroke elsewhere on the page.
  const filteredTeamPlayers = useMemo(() => {
    const players = rosterQuery.data ?? [];
    const q = playerSearch.trim().toLowerCase();
    return q ? players.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(q)) : players;
  }, [rosterQuery.data, playerSearch]);

  const availableCount = useMemo(() => candidates.filter((c) => !c.alreadyOnTeam).length, [candidates]);

  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    return candidates
      .filter((c) => !candidateTryoutFilter || c.tryoutIds.has(candidateTryoutFilter))
      .filter((c) => (q ? `${c.first} ${c.last}`.toLowerCase().includes(q) : true));
  }, [candidates, candidateTryoutFilter, candidateSearch]);

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

  const linkedTryouts = (tryoutsQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutsQuery.data ?? []).filter((t) => !t.teamId);
  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const teamPlayers = rosterQuery.data ?? [];

  const isAddingPlayers = addRosterPlayers.isPending || enrollingAssessments;

  const addPickedPlayers = async () => {
    const picked = candidates.filter((c) => pickedAthletes.has(c.athleteId));
    if (picked.length === 0) return;
    if (isAtPlayerLimit(user?.planTier ?? 'free', teamPlayers.length + picked.length - 1)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'players', 'players'));
      return;
    }
    const entries = picked.map((c) => ({
      athleteId: c.athleteId,
      jersey: c.jersey,
      pos: c.pos,
      sourceTryoutId: c.tryoutId,
    }));
    try {
      await addRosterPlayers.mutateAsync(entries);

      // Keep every assessment already linked to this team in sync: enroll each
      // picked athlete there too if they aren't already a participant on it.
      if (linkedTryouts.length > 0) {
        setEnrollingAssessments(true);
        const enrollments = picked.flatMap((c) =>
          linkedTryouts
            .filter((t) => !c.tryoutIds.has(t.id))
            .map((t) =>
              getDataSource().addPlayer(t.id, {
                athleteId: c.athleteId,
                first: c.first,
                last: c.last,
                jersey: c.jersey || '',
                pos: c.pos || '',
                yearOfBirth: c.yearOfBirth || '',
                // addPlayer ignores guardian fields once athleteId is set (existing
                // athlete) — passed through only to satisfy the now-required type.
                guardianEmail: c.guardianEmail || '',
              }),
            ),
        );
        if (enrollments.length > 0) {
          await Promise.all(enrollments);
          for (const t of linkedTryouts) qc.invalidateQueries({ queryKey: queryKeys.tryout(t.id) });
          qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
        }
      }

      setPickedAthletes(new Set());
      setCandidateTryoutFilter(null);
      setShowAddPlayers(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add players to the team.');
    } finally {
      setEnrollingAssessments(false);
    }
  };

  const confirmRemovePlayer = (athleteId: string, label: string) => {
    Alert.alert('Remove Player', `Remove ${label} from ${team.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeRosterPlayer.mutate(athleteId),
      },
    ]);
  };

  const teamSeason = seasonQuery.data;
  const upcomingEvents = [...(teamSeason?.events ?? [])]
    .filter((e) => e.date >= new Date().toISOString().split('T')[0])
    .sort((a, b) => a.date.localeCompare(b.date));

  // Availability is stored per invited season-roster player; the coach sees it
  // as a Yes/Maybe/No tally that expands into the actual names.
  const rsvpSummary = (ev: SeasonEvent) => {
    const byId = new Map((teamSeason?.roster ?? []).map((p) => [p.id, p]));
    const counts: Record<Rsvp, number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
    const rows = Object.entries(ev.availability ?? {})
      .filter(([playerId]) => byId.has(playerId))
      .map(([playerId, response]) => {
        const r = (response ?? 'pending') as Rsvp;
        counts[r] += 1;
        const player = byId.get(playerId)!;
        return {
          playerId,
          name: `${player.firstName} ${player.lastName}`,
          response: r,
        };
      });
    const order: Rsvp[] = ['yes', 'maybe', 'no', 'pending'];
    rows.sort((a, b) => order.indexOf(a.response) - order.indexOf(b.response));
    return { counts, rows };
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

  const submitEvent = eventForm.handleSubmit(
    async (data) => {
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      if (new Date(y, m - 1, d, hour, min) < new Date()) {
        const msg = 'Event must be scheduled from today onwards.';
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
          await addEvent.mutateAsync(data);
        }
        setShowAddEvent(false);
        setEditingEventId(null);
      } catch (e: any) {
        alertMsg('Error', e?.message || 'Could not save the event.');
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

  const runDummy = async (options: DummyDataOptions) => {
    setDummyProgress(null);
    try {
      const res = await genTest.mutateAsync(options);
      setShowDummy(false);
      Alert.alert(
        'Dummy data added',
        `Added ${res.players} players and ${res.evaluations} evaluations to ${dummyTarget?.name}.`,
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message === 'NO_RUBRICS'
        ? 'Add at least one rubric to that assessment before generating scored players.'
        : e?.message || 'Failed to generate dummy data.');
    } finally {
      setDummyProgress(null);
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearTest.mutateAsync();
      Alert.alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to clear dummy data.');
    }
  };

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setLogo(null);
    setCollectsFees(team.collectsFees ?? false);
    setFeeInput(team.registrationFeeCents ? (team.registrationFeeCents / 100).toFixed(2) : '');
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

    await updateTeam.mutateAsync({
      id: team.id,
      updates: { name: name.trim(), season: season.trim() || undefined, logoUrl, ...feeUpdates },
    });
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
            await deleteTeam.mutateAsync(team.id);
            navigation.replace('DashboardMain', { tab: 'teams' });
          },
        },
      ]
    );
  };

  const headerBlock = (
    <>
      <Header
        title={team.name}
        subtitle={team.season || undefined}
        showBack
        right={
          <View className="flex-row items-center gap-2">
            <ChatIconButton
              onPress={() =>
                navigation.navigate('TeamChat', {
                  seasonId: teamSeasonId,
                  title: `${team.name} Chat`,
                  subtitle: team.season || undefined,
                  noSeasonMessage:
                    "This team doesn't have a season yet. Add a practice or game under Schedule, and the chat opens for everyone on the roster and their guardians.",
                })
              }
            />
            <Button label="Edit" variant="ghost" size="sm" onPress={startEdit} />
          </View>
        }
      />
      {team.logoUrl ? (
        <View className="items-center mt-2 mb-4">
          <Avatar uri={team.logoUrl} first="T" last="M" size={80} />
        </View>
      ) : null}

      <Tabs
        tabs={[
          { key: 'schedule', label: 'Schedule', badge: upcomingEvents.length },
          { key: 'players', label: 'Players', badge: teamPlayers.length },
          { key: 'assessments', label: 'Assessments', badge: linkedTryouts.length },
          { key: 'settings', label: 'Settings' },
        ]}
        activeKey={tab}
        onChange={setTab}
        className="mt-2 mb-4"
      />
    </>
  );

  return (
    <Screen padded={false}>
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
            <Button
              label="Add Players from Assessments"
              size="sm"
              className="mb-3 self-start"
              onPress={() => {
                addPlayersPressAt.current = performance.now();
                setPickedAthletes(new Set());
                setCandidateSearch('');
                setCandidateTryoutFilter(null);
                setShowAddPlayers(true);
              }}
            />
            {teamPlayers.length > 0 ? (
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
            data={rosterQuery.isLoading ? [] : filteredTeamPlayers}
            keyExtractor={(p) => p.id}
            extraData={navigatingId}
            ListEmptyComponent={
              rosterQuery.isLoading ? (
                <View className="items-center py-6 gap-2">
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading roster...</Text>
                </View>
              ) : teamPlayers.length === 0 ? (
                <Card className="items-center py-6 gap-1">
                  <Text className="font-bold" style={{ color: colors.ink }}>No players yet</Text>
                  <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                    Pull players in from any assessment roster to build this team.
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
                  setNavigatingId(p.athleteId);
                  navigation.navigate('TeamPlayer', { id: team.id, playerId: p.athleteId });
                }}
              >
                <Card className="mb-2 flex-row items-center gap-3">
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
                  {navigatingId === p.athleteId ? (
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
      ) : tab === 'assessments' ? (
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
                <Text className="font-bold" style={{ color: colors.ink }}>No assessments linked</Text>
                <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                  Create a tryout or evaluation for this team, or attach one you already have.
                </Text>
              </Card>
            }
            renderItem={({ item: t }) => (
              <Pressable
                onPress={() => {
                  setNavigatingId(t.id);
                  navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: t.id } });
                }}
              >
                <Card className="mb-2 flex-row items-center justify-between">
                  <View className="flex-1 pr-2">
                    <Text className="font-bold" style={{ color: colors.ink }}>{t.name}</Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {t.sport} · {t.eventType} · {t.roster?.length ?? 0} players
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
          <PlanGate feature="seasonHub" title="Season Hub">
          <View>
            <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
              Season Hub
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              <Button label="+ Practice" size="sm" onPress={() => openEventModal('Practice')} />
              <Button label="+ Game" size="sm" variant="secondary" onPress={() => openEventModal('Game')} />
            </View>

            {seasonsQuery.isLoading || seasonQuery.isLoading ? (
              <View className="items-center py-6 gap-2">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading events...</Text>
              </View>
            ) : upcomingEvents.length === 0 ? (
              <Card className="items-center py-6 gap-1">
                <Text className="font-bold" style={{ color: colors.ink }}>No upcoming events</Text>
                <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
                  Add a practice or game — everyone on the roster is invited and their guardians can
                  RSVP from the portal.
                </Text>
              </Card>
            ) : (
              upcomingEvents.map((ev) => {
                const rsvp = rsvpSummary(ev);
                const expanded = openRsvpEventId === ev.id;
                return (
                  <Card key={ev.id} className="mb-3 gap-2">
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <Text className="font-bold text-base" style={{ color: colors.ink }}>
                          {ev.title}
                        </Text>
                        <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                          {ev.date}
                          {ev.startTime ? ` · ${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : ''}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </Text>
                      </View>
                      <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
                    </View>

                    <View className="flex-row items-center gap-2 py-1 flex-wrap">
                      <Badge label={`${rsvp.counts.yes} yes`} variant="success" size="lg" />
                      <Badge label={`${rsvp.counts.maybe} maybe`} variant="warning" size="lg" />
                      <Badge label={`${rsvp.counts.no} no`} variant="danger" size="lg" />
                      {rsvp.counts.pending > 0 ? (
                        <Badge label={`${rsvp.counts.pending} pending`} variant="info" size="lg" />
                      ) : null}
                    </View>

                    <Pressable
                      onPress={() => setOpenRsvpEventId(expanded ? null : ev.id)}
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
                      <Text style={{ color: colors.primary, fontSize: 14 }}>{expanded ? '▴' : '▾'}</Text>
                    </Pressable>

                    {expanded ? (
                      <View className="rounded-md border overflow-hidden" style={{ borderColor: colors.border }}>
                        {rsvp.rows.length === 0 ? (
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
                            </Text>
                            {rsvp.rows.map((r, i) => (
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
                          </>
                        )}
                      </View>
                    ) : null}

                    <View className="flex-row gap-2">
                      <Button label="Edit" variant="secondary" size="sm" onPress={() => openEditEventModal(ev)} />
                      <Button
                        label="Delete"
                        variant="ghost"
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
            <Card className="mb-3 gap-2">
              <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Team
              </Text>
              <Button label="Edit Team Details" variant="secondary" size="sm" onPress={startEdit} />
            </Card>

            {isAssociation ? (
              <Card className="mb-3 gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Testing Tools
                </Text>
                {dummyTarget ? (
                  <>
                    <Text className="text-xs" style={{ color: colors.inkMuted }}>
                      Generate dummy players — optionally scored — into{' '}
                      <Text className="font-bold">{dummyTarget.name}</Text>. They appear under Players.
                    </Text>
                    <View className="flex-row flex-wrap gap-2 mt-1">
                      <Button label="Dummy Players" size="sm" onPress={() => setShowDummy(true)} />
                      <Button
                        label="Clear Dummy Data"
                        size="sm"
                        variant="ghost"
                        loading={clearTest.isPending}
                        onPress={runClearDummy}
                      />
                    </View>
                  </>
                ) : (
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Link an assessment to this team first — dummy players are added to an assessment's
                    roster, which is what fills the Players list.
                  </Text>
                )}
              </Card>
            ) : null}

            <Card className="gap-2">
              <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.danger }}>
                Danger Zone
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Deleting a team removes its roster, schedule, and links to assessments.
              </Text>
              <Button label="Delete Team" variant="danger" size="sm" onPress={handleDelete} loading={deleteTeam.isPending} />
            </Card>
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
        title="Attach Assessment"
        onClose={() => {
          if (updateTryout.isPending) return;
          setShowAttachModal(false);
        }}
      >
        <View style={{ gap: 2 }}>
          {unlinkedTryouts.length === 0 ? (
            <Text style={{ color: colors.inkMuted, padding: 12 }}>No assessments available to link.</Text>
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
                    Alert.alert('Error', e.message || 'Could not link assessment.');
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
                  {isAttaching ? 'Attaching...' : `${t.sport} · ${t.roster.length} players`}
                </Text>
              </Pressable>
              );
            })
          )}
        </View>
      </Modal>

      <Modal
        visible={showAddPlayers}
        title="Add Players from Assessments"
        scroll={false}
        onClose={() => {
          if (isAddingPlayers) return;
          setShowAddPlayers(false);
        }}
        footer={
          <View className="mt-4">
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
          <LoadingState message="Adding players..." />
        ) : candidates.length === 0 ? (
          <Text className="text-sm py-3" style={{ color: colors.inkMuted }}>
            No assessments have players yet — add players to an assessment roster first.
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
                Athletes from all of your assessments. Tap to select.
              </Text>
              {availableCount > 0 ? (
                <Pressable
                  onPress={() =>
                    setPickedAthletes((prev) =>
                      prev.size === availableCount
                        ? new Set()
                        : new Set(candidates.filter((c) => !c.alreadyOnTeam).map((c) => c.athleteId)),
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

      <Modal
        visible={showAddEvent}
        title={editingEventId ? `Edit ${eventType}` : `Add ${eventType}`}
        onClose={() => {
          setShowAddEvent(false);
          setEditingEventId(null);
        }}
      >
        <View className="gap-3">
          <View className="flex-row flex-wrap">
            {EVENT_KINDS.map((t) => (
              <Chip key={t} label={t} active={eventType === t} onPress={() => eventForm.setValue('type', t)} />
            ))}
          </View>
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
              <Input label="Location" onBlur={onBlur} onChangeText={onChange} value={value} />
            )}
          />
          {editingEventId ? null : (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Everyone on the roster is invited by default.
            </Text>
          )}
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

      <DummyDataModal
        variant="assessment"
        visible={showDummy}
        loading={genTest.isPending}
        progress={dummyProgress ?? undefined}
        hasRubrics={(dummyTarget?.settings.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowDummy(false);
          if (dummyTarget) {
            navigation.navigate('AssessmentFlow', {
              screen: 'AssessmentRubrics',
              params: { id: dummyTarget.id },
            });
          }
        }}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />

      <BottomNav active="teams" />
    </Screen>
  );
}
