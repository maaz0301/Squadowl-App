import { useTerms, sportLabel } from '@/lib/terms';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { DummyDataModal } from '@/components/DummyDataModal';
import { DeleteProgressModal } from '@/components/DeleteProgressModal';
import { ImportPlayersModal } from '@/components/roster/ImportPlayersModal';
import { PlayerRow } from '@/components/roster/PlayerRow';
import { ChevronIcon, PlusIcon } from '@/components/roster/icons';
import { RosterActions, RosterFilters, RosterSearch, RosterSelectToolbar, ScoreCta } from '@/components/roster/RosterControls';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Modal,
  Screen,
  useTypeToConfirm,
} from '@/components/ui';
import { isAtPlayerLimit, playerRoom, playersTowardCap } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import { capImportRows, dropExistingPlayers, withSkippedRows } from '@/data/bulkTeamImport';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';
import {
  useAddPlayerMutation,
  useClearTestDataMutation,
  useDeletePlayersMutation,
  useGenerateTestDataMutation,
  useImportTryoutPlayersMutation,
  useSessionProgressQuery,
  useTryoutQuery,
  useTryoutRosterInvitesMutation,
  useUploadPlayerPhotoMutation,
  tryoutBulkWriteKey,
  useAccountPlayerCount,
} from '@/features/queries';
import { useIsMutating } from '@tanstack/react-query';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useCompleteAssessing } from '@/features/useCompleteAssessing';
import { useUser } from '@/state/authStore';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useSessionStore, type RosterFilter } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterScreen() {
  const typeToConfirm = useTypeToConfirm();
  const id = useAssessmentId();
  const isAssessorOnly = useAssessorMode();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels, tryoutQuery.data?.sport);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  // Free plans share one pool of players across evaluations and teams.
  const accountPlayers = useAccountPlayerCount(effectiveTier === 'free');
  const addPlayer = useAddPlayerMutation(id!);
  const inviteParticipant = useTryoutRosterInvitesMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const importPlayers = useImportTryoutPlayersMutation(id!);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const deletePlayers = useDeletePlayersMutation(id!, (done, total) => setDeleteProgress({ done, total }));
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(id!, (done, total) => setDummyProgress({ done, total }));
  // genTest.isPending flips false the instant generateTestData resolves —
  // before the roster refetch below has even started. Tracked separately so
  // the modal keeps showing "loading" through that refetch too, instead of
  // going quiet right as the batch finishes.
  const [refetchingAfterDummy, setRefetchingAfterDummy] = useState(false);
  const clearTest = useClearTestDataMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  // The filter lives in the persisted session store, so without this a
  // "Scored" pick on one evaluation greets the next (or a fresh, all-unscored
  // one) with "No players match".
  useEffect(() => {
    setRosterFilter('all');
  }, [id, setRosterFilter]);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const [showAdd, setShowAdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // A bulk add started from another screen (the Registrations tab's dummy-data
  // dialog, typically) keeps writing players for minutes without this screen's
  // query ever refetching — so without checking for it, an in-progress 1000
  // player run looks exactly like an assessment nobody has added anyone to.
  const bulkWriting = useIsMutating({ mutationKey: tryoutBulkWriteKey(id ?? '') }) > 0;
  const [playerSearch, setPlayerSearch] = useState('');
  // 'recent' leaves the roster in whatever order the read returned (the order
  // players were added); 'name'/'age' sort it client-side — the whole roster
  // is already in memory here, unlike the paginated team roster, so no extra
  // read is needed.
  const [rosterSort, setRosterSort] = useState<'recent' | 'name' | 'age'>('recent');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  // An invited assessor scores; they don't seed data into the owner's evaluation.
  // Their own plan tier says nothing about that, so the tier alone must not
  // decide it now that the tools are no longer Association-only.
  const showDummyTools = useCanUseDummyData(effectiveTier) && !isAssessorOnly;

  useEffect(() => {
    if (tryoutQuery.data && user && !activeAssessor) {
      const me = tryoutQuery.data.assessors.find(
        (a) => (user.email && a.email === user.email) || (user.displayName && a.name === user.displayName)
      );
      if (me) {
        setActiveAssessor(me);
      }
    }
  }, [tryoutQuery.data, user, activeAssessor, setActiveAssessor]);

  // One pass over `evals` (not one per row, not one per render) to get each
  // player's eval count — the FlatList row below and `scoredCount` further
  // down both just look this up instead of filtering the full evals array.
  const evalCountByPlayerId = useMemo(() => {
    const counts = new Map<string, number>();
    if (!tryoutQuery.data) return counts;
    for (const e of tryoutQuery.data.evals) {
      counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1);
    }
    return counts;
  }, [tryoutQuery.data]);

  // An assessor reads back none of the assessment's evaluations — scoring is
  // blind, so get_evaluations_for_tryouts() only returns rows to account staff
  // — and off `evals` alone every player they've just scored still counts as
  // unscored. For them "scored" comes from the session-progress RPC instead:
  // which players have a session saved, and nothing about the scores.
  const sessionProgressQuery = useSessionProgressQuery(id, isAssessorOnly);
  const scoredIds = useMemo(() => {
    const ids = new Set(evalCountByPlayerId.keys());
    if (isAssessorOnly) {
      for (const [playerId, maxSession] of Object.entries(sessionProgressQuery.data ?? {})) {
        if (maxSession > 0) ids.add(playerId);
      }
    }
    return ids;
  }, [evalCountByPlayerId, isAssessorOnly, sessionProgressQuery.data]);

  // Every sport gets the same three filters. The filter is remembered across
  // assessments, so a position filter saved before they were removed falls back
  // to All instead of leaving the roster filtered by something with no chip.
  const activeFilter: RosterFilter =
    rosterFilter === 'all' || rosterFilter === 'scored' || rosterFilter === 'unscored' ? rosterFilter : 'all';

  const filteredRoster = useMemo(() => {
    if (!tryoutQuery.data) return [];
    const { roster } = tryoutQuery.data;
    let result;
    switch (activeFilter) {
      case 'scored':
        result = roster.filter((p) => scoredIds.has(p.id));
        break;
      case 'unscored':
        result = roster.filter((p) => !scoredIds.has(p.id));
        break;
      default:
        result = roster;
    }
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      // Jersey number too, not just name: a coach scanning a bench sheet reads
      // numbers first, and on a roster in the hundreds "who's #59" is a much
      // faster search than spelling a last name right on the first try.
      result = result.filter(
        (p) => `${p.first} ${p.last}`.toLowerCase().includes(search) || p.jersey?.toLowerCase().includes(search),
      );
    }
    if (rosterSort === 'name') {
      result = [...result].sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
    } else if (rosterSort === 'age') {
      // Oldest first, the usual reading order for a roster sorted "by age". A
      // missing/unparseable birth year sinks to the bottom on either sort
      // rather than being guessed at as oldest.
      result = [...result].sort((a, b) => {
        const ayRaw = parseInt(a.yearOfBirth ?? '', 10);
        const byRaw = parseInt(b.yearOfBirth ?? '', 10);
        const ay = Number.isFinite(ayRaw) ? ayRaw : null;
        const by = Number.isFinite(byRaw) ? byRaw : null;
        if (ay == null) return by == null ? 0 : 1;
        if (by == null) return -1;
        return ay - by;
      });
    }
    return result;
  }, [tryoutQuery.data, activeFilter, playerSearch, rosterSort, scoredIds]);

  // Every filter's count, whichever one is showing: a chip that says how many
  // players it would leave answers "how much is left to score?" without the
  // coach having to select it and read the list length.
  const filterCounts = useMemo((): Record<string, number> => {
    const roster = tryoutQuery.data?.roster ?? [];
    const scored = roster.filter((p) => scoredIds.has(p.id)).length;
    const counts: Record<string, number> = { all: roster.length, scored, unscored: roster.length - scored };
    return counts;
  }, [tryoutQuery.data, scoredIds]);

  const { canComplete, completing, complete } = useCompleteAssessing(tryoutQuery.data);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const capCount = playersTowardCap(effectiveTier, tryout.roster.length, accountPlayers);

  const openAdd = () => {
    if (isAtPlayerLimit(effectiveTier, capCount)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    setShowAdd(true);
  };

  // Same plan gate as adding one by hand — a spreadsheet is a faster way onto
  // the roster, not a way around the cap.
  const openImport = () => {
    if (isAtPlayerLimit(effectiveTier, capCount)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    setShowImport(true);
  };

  const openPlayer = (playerId: string) => {
    setCurrentPlayer(playerId);
    navigation.navigate('AssessmentFlow', {
      screen: 'AssessmentPlayer',
      params: { id: id, playerId, isAssessorOnly },
    });
  };

  const toggleSelected = (playerId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = () => {
    const ids = [...selectedIds];
    typeToConfirm.ask({
      title: terms.t('Delete players?'),
      message: terms.t(`${ids.length} player${ids.length === 1 ? '' : 's'} will be permanently removed from this roster.`),
      onConfirm: async () => {
        setDeleteProgress({ done: 0, total: ids.length });
        setDeletingSelected(true);
        try {
          const { deleted, failed } = await deletePlayers.mutateAsync(ids);
          if (failed.length === 0) {
            exitSelectMode();
          } else {
            // Keep only the players that are still on the roster selected,
            // so a retry goes straight at what is left.
            const gone = new Set(deleted);
            setSelectedIds(new Set(ids.filter((pid) => !gone.has(pid))));
            Alert.alert(
              terms.t('Some Players Were Not Deleted'),
              `${deleted.length} of ${ids.length} deleted. ${failed.length} could not be removed: ${failed[0].message}`,
            );
          }
        } catch (e: any) {
          Alert.alert('Delete Failed', e?.message || terms.t('Could not delete the selected players.'));
        } finally {
          setDeletingSelected(false);
          setDeleteProgress(null);
        }
      },
    });
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = filterCounts.scored;
  // A background refetch keeps rendering the *previous* cached tryout, which
  // right after a bulk add (dummy data, or QR registrations placed onto the
  // roster) is still the empty one — `isLoading` is false the whole time
  // because data technically exists. So an empty roster while a fetch or a
  // bulk write is in flight means "not known yet", not "no players": showing
  // the add-your-first-player prompt there is what made a slow refetch, or a
  // still-running 1000-player generation, look like an empty assessment.
  const rosterPending = !hasPlayers && (tryoutQuery.isFetching || bulkWriting);

  return (
    <Screen padded={false}>
      {typeToConfirm.modal}
      <View className="px-4">
        <Header
          title={tryout.name}
          showBack
          onBack={() => navigation.navigate('DashboardMain', { tab: 'assessments' })}
        />
      </View>
      {hasPlayers ? (
        <View className="gap-2 px-4 pb-3">
          <UsageNudgeBanner
            tier={effectiveTier}
            metric="players"
            count={tryout.roster.length}
            label={terms.t('players in this roster')}
          />

          <ScoreCta
            playersLabel={terms.players}
            total={tryout.roster.length}
            scored={scoredCount}
            onPress={() =>
              navigation.navigate('AssessmentFlow', {
                screen: 'AssessmentRinkside',
                params: { id: id, isAssessorOnly },
              })
            }
          />

          {selectMode ? (
            <RosterSelectToolbar
              allSelected={selectedIds.size > 0 && selectedIds.size === filteredRoster.length}
              count={selectedIds.size}
              deleting={deletingSelected}
              onBack={exitSelectMode}
              onToggleAll={() =>
                setSelectedIds(
                  selectedIds.size === filteredRoster.length
                    ? new Set()
                    : new Set(filteredRoster.map((p) => p.id)),
                )
              }
              onDeleteSelected={deleteSelected}
            />
          ) : (
            <RosterActions
              onAdd={openAdd}
              onImport={openImport}
              onSelect={() => setSelectMode(true)}
              onTools={() => setShowTools(true)}
              onCompleteAssessing={canComplete ? () => complete() : undefined}
              completingAssessing={completing}
            />
          )}

          {tryout.assessors.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Scoring as
              </Text>
              {/* One scrolling row: an association tryout can have a dozen
                  assessors, and wrapping them pushed the players themselves
                  off the bottom of the screen. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingRight: 8 }}
              >
                {tryout.assessors.map((a, i) => {
                  const isMe = !!((user?.email && a.email === user.email) || (user?.displayName && a.name === user.displayName));
                  const tags = [];
                  if (isMe) tags.push('You');
                  if (a.role === 'lead') tags.push('Owner');
                  const label = tags.length ? `${a.name} (${tags.join(', ')})` : a.name;

                  const isActive = activeAssessor?.name === a.name && activeAssessor?.email === a.email;

                  return (
                    <Chip
                      key={`${a.name}-${a.email}-${i}`}
                      label={label}
                      active={isActive}
                      highlight={isMe}
                      onPress={() => setActiveAssessor(isActive ? null : a)}
                      className="mb-0"
                    />
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <RosterSearch
            value={playerSearch}
            onChange={setPlayerSearch}
            playersLabel={terms.players}
            jerseyLabel={terms.jersey}
          />

          <RosterFilters
            active={activeFilter}
            counts={filterCounts}
            onSelect={setRosterFilter}
          />

          <View className="flex-row flex-wrap -mb-2">
            <Chip label="Recent" active={rosterSort === 'recent'} onPress={() => setRosterSort('recent')} />
            <Chip label="A–Z" active={rosterSort === 'name'} onPress={() => setRosterSort('name')} />
            <Chip label="Age" active={rosterSort === 'age'} onPress={() => setRosterSort('age')} />
          </View>
        </View>
      ) : null}

      <FlatList
        data={filteredRoster}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flexGrow: 1 }}
        // A tryout roster runs to hundreds of players. Without these the list
        // mounts ten screens' worth of rows before it paints anything, which
        // reads as the roster still loading well after the data has arrived.
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          rosterPending ? (
            <View className="flex-1 items-center justify-center px-6 gap-3">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text className="text-base text-center" style={{ color: colors.inkMuted }}>
                {bulkWriting ? terms.t('Adding players...') : 'Loading roster...'}
              </Text>
            </View>
          ) : hasPlayers ? (
            <EmptyState
              title={terms.t('No players match')}
              message={
                playerSearch.trim()
                  ? terms.t(`No players match "${playerSearch.trim()}".`)
                  : terms.t(`No ${rosterFilter} players. Try a different filter.`)
              }
              actionLabel={playerSearch.trim() ? 'Clear search' : 'Show all'}
              onAction={() => {
                setPlayerSearch('');
                setRosterFilter('all');
              }}
            />
          ) : (
            <View className="flex-1 items-center justify-center px-2">
              <View
                className="h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
              >
                <PlusIcon color={colors.primary} size={26} />
              </View>
              <Text
                className="mt-4 text-center font-display text-xl font-bold"
                style={{ color: colors.ink }}
              >
                Add your {terms.players.toLowerCase()} to get started
              </Text>
              <Text className="mb-6 mt-2 text-center text-sm" style={{ color: colors.inkMuted }}>
                Add {terms.players.toLowerCase()} to this evaluation, then you can start scoring.
              </Text>
              <Button label={`+ Add ${terms.player}`} onPress={openAdd} className="w-full" />
              <Button
                label="Import from a spreadsheet"
                variant="secondary"
                onPress={openImport}
                className="mt-2 w-full"
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <PlayerRow
            player={item}
            evalCount={evalCountByPlayerId.get(item.id) ?? 0}
            hideUnscored={isAssessorOnly}
            selectable={selectMode}
            selected={selectedIds.has(item.id)}
            onToggleSelect={toggleSelected}
            onPress={openPlayer}
          />
        )}
      />

      <Modal
        visible={showAdd}
        title={`Add ${terms.player}`}
        onClose={() => setShowAdd(false)}
        footer={
          <Button label="Cancel" variant="secondary" onPress={() => setShowAdd(false)} />
        }
      >
        <AddPlayerForm
          existingPlayers={tryout.roster}
          sport={tryout.sport}
          labels={tryout.settings.customLabels}
          loading={addPlayer.isPending || uploadPhoto.isPending || inviteParticipant.isPending}
          submitLabel={`Save ${terms.player} & Send Invite`}
          onSubmit={async (data) => {
            // Saving a player here now links them to the portal too, same as
            // adding one to a season or team roster — until now an assessor
            // could add a player with a guardian email and that guardian had
            // no way in at all, since a tryout roster had no invite mechanism
            // of any kind. This form has no Invite toggles (that's web-only),
            // so every address the player has on file is mailed.
            let player: Awaited<ReturnType<typeof addPlayer.mutateAsync>>;
            try {
              player = await addPlayer.mutateAsync(data);
              if (player.athleteId && data.avatarUrl && data.avatarUrl.startsWith('file://')) {
                try {
                  await uploadPhoto.mutateAsync({
                    athleteId: player.athleteId,
                    fileUri: data.avatarUrl,
                    fileType: 'image/jpeg',
                  });
                } catch (e: any) {
                  Alert.alert('Upload Error', 'Failed to upload profile picture: ' + e.message);
                }
              }
              setShowAdd(false);
            } catch (err: any) {
              Alert.alert(
                'Save Error',
                err.message || 'Failed to add player.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Retry', onPress: () => addPlayer.mutate(data) }
                ]
              );
              return;
            }

            // Its own try/catch, deliberately outside the one above: the
            // player is on the roster whatever the invite does, and a failed
            // send here must never show as "Save Error" with a Retry that
            // would re-run addPlayer and create a second participant. Only a
            // bounce or a guardian with no address on file is worth an alert.
            try {
              const result = await inviteParticipant.mutateAsync({ participantIds: [player.id] });
              if (inviteNeedsAttention(result)) {
                const { title, message } = describeInviteResult(result);
                Alert.alert(title, message);
              }
            } catch (e: any) {
              Alert.alert(
                'Invite Not Sent',
                `${`${data.first} ${data.last}`.trim()} was added to the roster, but the portal invite could not be sent: ${
                  e?.message || 'Unknown error'
                }`,
              );
            }
          }}
        />
      </Modal>

      <Modal visible={showTools} title="Tools" onClose={() => setShowTools(false)}>
        {(
          [
            {
              label: 'Team Builder',
              desc: terms.t('Auto-split scored players into balanced teams.'),
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: id } }),
            },
            {
              label: 'Roster Library',
              desc: terms.t('Import players from past seasons or other evaluations.'),
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRosterLibrary', params: { id: id } }),
            },
            {
              label: 'Import Scores from Excel',
              desc: 'Import results from a spreadsheet and assign its columns to your measures.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScanSheet', params: { id: id } }),
            },
            // Letters is a coach decision (who made the team), not a scoring
            // one — hidden from the Tools menu for an invited assessor the
            // same way it's gated on its own screen.
            ...(isAssessorOnly ? [] : [
              {
                label: terms.t('Player Selection Letters'),
                desc: 'Create and send offer or roster decision letters, with a copy attached to each player.',
                go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentLetters', params: { id: id, isAssessorOnly } }),
              },
            ]),
            ...(showDummyTools ? [
              {
                label: 'Dummy Data Generator',
                desc: terms.t('Generate batch of realistic dummy players with optional scoring data across rubrics.'),
                go: () => setShowTestGen(true),
              },
              {
                label: 'Clear Dummy Data',
                desc: terms.t('Remove all generated dummy players and evaluation scores.'),
                go: () =>
                  typeToConfirm.ask({
                    title: 'Clear Dummy Data',
                    message: 'Remove all generated dummy players and their scores? This can\'t be undone.',
                    onConfirm: async () => {
                      try {
                        const res = await clearTest.mutateAsync();
                        if (Platform.OS === 'web') alert(`Cleared ${res.removed} dummy records.`);
                        else Alert.alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
                      } catch (e: any) {
                        if (Platform.OS === 'web') alert(e?.message || 'Failed to clear dummy data.');
                        else Alert.alert('Error', e?.message || 'Failed to clear dummy data.');
                      }
                    },
                  }),
              },
            ] : []),
          ] as const
        ).map((t) => (
          <Pressable
            key={t.label}
            onPress={() => {
              setShowTools(false);
              t.go();
            }}
            className="mb-2 flex-row items-center gap-3 rounded-xl border px-3 py-3 active:opacity-70"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <View className="flex-1">
              <Text className="text-base font-bold" style={{ color: colors.ink }}>
                {t.label}
              </Text>
              <Text className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                {t.desc}
              </Text>
            </View>
            <ChevronIcon color={colors.inkFaint} size={16} />
          </Pressable>
        ))}
      </Modal>

      <ImportPlayersModal
        labels={tryout.settings.customLabels}
        sport={tryout.sport}
        visible={showImport}
        onClose={() => setShowImport(false)}
        target={tryout.name}
        atLimit={isAtPlayerLimit(effectiveTier, capCount)}
        onLimitReached={() => setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'))}
        onImport={async (rows, onProgress) => {
          // A spreadsheet is a faster way onto the roster, not a way around the
          // plan's player cap: players already here are set aside first (they add
          // nobody, so they shouldn't spend the cap), then what fits goes in and
          // the rest is listed as not added.
          const { fresh, duplicates } = dropExistingPlayers(rows, tryout.roster);
          const capped = capImportRows(fresh, playerRoom(effectiveTier, capCount));
          const allowed = capped.allowed;
          const skipped = [...duplicates, ...capped.skipped];
          if (allowed.length === 0) {
            return withSkippedRows({ added: 0, failed: [], athleteIds: [], participantIds: [] }, skipped);
          }
          const result = withSkippedRows(await importPlayers.mutateAsync({ rows: allowed, onProgress }), skipped);
          // The mutation only marks the roster stale; on a capped plan, wait for
          // the fresh count so the "Import more" check that follows never runs
          // against the old one. Unlimited plans have no such check, so they
          // don't wait on a full roster re-read (a thousand players is seconds).
          if (Number.isFinite(playerRoom(effectiveTier, 0))) {
            await tryoutQuery.refetch({ cancelRefetch: false });
          }
          // Same rule as adding one by hand above, and as the team import: the
          // import is what earns the portal invite, so a spreadsheet of players
          // with guardian emails links them all without anyone opening thirty
          // profiles. Scoped to the rows the import actually landed, so a
          // re-import doesn't re-mail the players already there.
          //
          // No dialog on the way out, unlike the manual add: the modal shows
          // its own per-row import summary the moment this returns, and a
          // second dialog in front of it — "no email on file for these four" —
          // buries the one the coach is waiting for.
          if (result.participantIds?.length) {
            try {
              await inviteParticipant.mutateAsync({ participantIds: result.participantIds });
            } catch (e) {
              console.warn('Portal invites failed after a roster import:', e);
            }
          }
          return result;
        }}
      />

      <DeleteProgressModal visible={deletingSelected} progress={deleteProgress} />

      <DummyDataModal
        variant="assessment"
        maxPlayers={playerRoom(effectiveTier, capCount)}
        visible={showTestGen}
        loading={genTest.isPending || refetchingAfterDummy}
        progress={dummyProgress ?? undefined}
        hasRubrics={(tryout.settings?.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowTestGen(false);
          navigation.navigate('AssessmentFlow', { screen: 'AssessmentRubrics', params: { id: id } });
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={async (options) => {
          setDummyProgress(null);
          try {
            const res = await genTest.mutateAsync(options);
            // useGenerateTestDataMutation's onSuccess only invalidates (marks
            // stale) — explicitly refetch here so the roster behind this modal
            // is guaranteed to already show the new players/evals by the time
            // it closes, instead of waiting on whatever triggers the next
            // background refresh.
            setRefetchingAfterDummy(true);
            await tryoutQuery.refetch();
            const parts = [
              res.registrations ? `${res.registrations} pending registrations` : null,
              res.players ? `${res.players} roster players` : null,
              res.evaluations ? `${res.evaluations} evaluations` : null,
            ].filter(Boolean);
            if (Platform.OS === 'web') alert(`Dummy data added: Created ${parts.join(', ')}.`);
            else Alert.alert('Dummy data added', `Created ${parts.join(', ')}.`);
          } catch (e: any) {
            const msg = e?.message === 'NO_RUBRICS'
              ? terms.t('Add at least one rubric before generating scored players.')
              : e?.message || 'Failed to generate dummy data.';
            if (Platform.OS === 'web') alert(msg);
            else Alert.alert('Error', msg);
          } finally {
            // In `finally`, not after the await: generateTestData writes
            // incrementally, so a partial run still created real rows and the
            // modal must not stay open over a stale form.
            setShowTestGen(false);
            setDummyProgress(null);
            setRefetchingAfterDummy(false);
          }
        }}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
