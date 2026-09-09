import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { DummyDataModal } from '@/components/DummyDataModal';
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
} from '@/components/ui';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { isGoaliePosition } from '@/data/rubrics';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import {
  useAddPlayerMutation,
  useClearTestDataMutation,
  useDeletePlayerMutation,
  useGenerateTestDataMutation,
  useImportTryoutPlayersMutation,
  useTryoutQuery,
  useUploadPlayerPhotoMutation,
  tryoutBulkWriteKey,
} from '@/features/queries';
import { useIsMutating } from '@tanstack/react-query';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useSessionStore, type RosterFilter } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterScreen() {
  const id = useAssessmentId();
  const isAssessorOnly = useAssessorMode();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const importPlayers = useImportTryoutPlayersMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

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

  const filteredRoster = useMemo(() => {
    if (!tryoutQuery.data) return [];
    const { roster } = tryoutQuery.data;
    let result;
    switch (rosterFilter) {
      case 'scored':
        result = roster.filter((p) => evalCountByPlayerId.has(p.id));
        break;
      case 'unscored':
        result = roster.filter((p) => !evalCountByPlayerId.has(p.id));
        break;
      case 'goalies':
        result = roster.filter((p) => isGoaliePosition(p.pos));
        break;
      case 'skaters':
        result = roster.filter((p) => !isGoaliePosition(p.pos));
        break;
      default:
        result = roster;
    }
    const search = playerSearch.trim().toLowerCase();
    if (search) {
      result = result.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(search));
    }
    return result;
  }, [tryoutQuery.data, rosterFilter, playerSearch, evalCountByPlayerId]);

  // Every filter's count, whichever one is showing: a chip that says how many
  // players it would leave answers "how much is left to score?" without the
  // coach having to select it and read the list length.
  const filterCounts = useMemo((): Record<RosterFilter, number> => {
    const roster = tryoutQuery.data?.roster ?? [];
    const scored = roster.filter((p) => evalCountByPlayerId.has(p.id)).length;
    const goalies = roster.filter((p) => isGoaliePosition(p.pos)).length;
    return {
      all: roster.length,
      scored,
      unscored: roster.length - scored,
      goalies,
      skaters: roster.length - goalies,
    };
  }, [tryoutQuery.data, evalCountByPlayerId]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;

  const openAdd = () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'players', 'players'));
      return;
    }
    setShowAdd(true);
  };

  const openPlayer = (playerId: string) => {
    setCurrentPlayer(playerId);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentPlayer', params: { id: id, playerId } });
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
    Alert.alert(
      'Delete players?',
      `${ids.length} player${ids.length === 1 ? '' : 's'} will be permanently removed from this roster.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingSelected(true);
            try {
              await Promise.all(ids.map((pid) => deletePlayer.mutateAsync(pid)));
              exitSelectMode();
            } catch (e: any) {
              Alert.alert('Delete Failed', e?.message || 'Could not delete the selected players.');
            } finally {
              setDeletingSelected(false);
            }
          },
        },
      ]
    );
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = evalCountByPlayerId.size;
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
      <Header
        title={tryout.name}
        showBack
        onBack={() => navigation.navigate('DashboardMain')}
      />
      {hasPlayers ? (
        <View className="gap-2 px-4 pb-3">
          <UsageNudgeBanner
            tier={user?.planTier ?? 'free'}
            metric="players"
            count={tryout.roster.length}
            label="players in this roster"
          />

          <ScoreCta
            total={tryout.roster.length}
            scored={scoredCount}
            onPress={() =>
              navigation.navigate('AssessmentFlow', { screen: 'AssessmentRinkside', params: { id: id } })
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
              onImport={() => setShowImport(true)}
              onSelect={() => setSelectMode(true)}
              onTools={() => setShowTools(true)}
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

          <RosterSearch value={playerSearch} onChange={setPlayerSearch} />

          <RosterFilters active={rosterFilter} counts={filterCounts} onSelect={setRosterFilter} />
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
                {bulkWriting ? 'Adding players...' : 'Loading roster...'}
              </Text>
            </View>
          ) : hasPlayers ? (
            <EmptyState
              title="No players match"
              message={
                playerSearch.trim()
                  ? `No players match "${playerSearch.trim()}".`
                  : `No ${rosterFilter} players. Try a different filter.`
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
                Add your players to get started
              </Text>
              <Text className="mb-6 mt-2 text-center text-sm" style={{ color: colors.inkMuted }}>
                Add players to this evaluation, then you can start scoring.
              </Text>
              <Button label="+ Add Player" onPress={openAdd} className="w-full" />
              <Button
                label="Import from a spreadsheet"
                variant="secondary"
                onPress={() => setShowImport(true)}
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
        title="Add Player"
        onClose={() => setShowAdd(false)}
        footer={
          <Button label="Cancel" variant="secondary" onPress={() => setShowAdd(false)} />
        }
      >
        <AddPlayerForm
          sport={tryout.sport}
          loading={addPlayer.isPending || uploadPhoto.isPending}
          onSubmit={async (data) => {
            try {
              const player = await addPlayer.mutateAsync(data);
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
            }
          }}
        />
      </Modal>

      <Modal visible={showTools} title="Tools" onClose={() => setShowTools(false)}>
        {(
          [
            {
              label: 'Team Builder',
              desc: 'Auto-split scored players into balanced teams.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: id } }),
            },
            {
              label: 'Roster Library',
              desc: 'Import players from past seasons or other evaluations.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRosterLibrary', params: { id: id } }),
            },
            {
              label: 'Scan Sheet Import',
              desc: 'Import scores from printed OCR scanning sheets.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScanSheet', params: { id: id } }),
            },
            // Letters is a coach decision (who made the team), not a scoring
            // one — hidden from the Tools menu for an invited assessor the
            // same way it's gated on its own screen.
            ...(isAssessorOnly ? [] : [
              {
                label: 'Player Selection Letters',
                desc: 'Create and send offer or roster decision letters, with a copy attached to each player.',
                go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentLetters', params: { id: id, isAssessorOnly } }),
              },
            ]),
            ...(isAssociation ? [
              {
                label: 'Dummy Data Generator',
                desc: 'Generate batch of realistic dummy players with optional scoring data across rubrics.',
                go: () => setShowTestGen(true),
              },
              {
                label: 'Clear Dummy Data',
                desc: 'Remove all generated dummy players and evaluation scores.',
                go: async () => {
                  try {
                    const res = await clearTest.mutateAsync();
                    if (Platform.OS === 'web') alert(`Cleared ${res.removed} dummy records.`);
                    else Alert.alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
                  } catch (e: any) {
                    if (Platform.OS === 'web') alert(e?.message || 'Failed to clear dummy data.');
                    else Alert.alert('Error', e?.message || 'Failed to clear dummy data.');
                  }
                },
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
        visible={showImport}
        onClose={() => setShowImport(false)}
        target={tryout.name}
        onImport={(rows, onProgress) => importPlayers.mutateAsync({ rows, onProgress })}
      />

      <DummyDataModal
        variant="assessment"
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
              ? 'Add at least one rubric before generating scored players.'
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
