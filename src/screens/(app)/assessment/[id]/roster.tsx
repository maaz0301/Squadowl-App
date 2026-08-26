import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, Text, View } from 'react-native';

import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
} from '@/components/ui';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { playerDisplayName } from '@/data/rubrics';
import {
  useAddPlayerMutation,
  useClearTestDataMutation,
  useGenerateTestDataMutation,
  useTryoutQuery,
  useUploadPlayerPhotoMutation,
  tryoutBulkWriteKey,
} from '@/features/queries';
import { useIsMutating } from '@tanstack/react-query';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function RosterScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
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
  const [showTestGen, setShowTestGen] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // A bulk add started from another screen (the Registrations tab's dummy-data
  // dialog, typically) keeps writing players for minutes without this screen's
  // query ever refetching — so without checking for it, an in-progress 1000
  // player run looks exactly like an assessment nobody has added anyone to.
  const bulkWriting = useIsMutating({ mutationKey: tryoutBulkWriteKey(id ?? '') }) > 0;
  const [playerSearch, setPlayerSearch] = useState('');

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
        result = roster.filter((p) => p.pos?.toUpperCase() === 'GTL');
        break;
      case 'skaters':
        result = roster.filter((p) => p.pos?.toUpperCase() !== 'GTL');
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
        <View className="px-4 pt-2 pb-3 gap-3">
          <UsageNudgeBanner
            tier={user?.planTier ?? 'free'}
            metric="players"
            count={tryout.roster.length}
            label="players in this roster"
          />
          <View className="flex-row gap-2">
            <Button
              label="Score Players"
              onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRinkside', params: { id: id } })}
              className="flex-1"
            />
            <Button label="+ Add" variant="secondary" onPress={openAdd} />
            <Button label="Tools" variant="ghost" onPress={() => setShowTools(true)} />
          </View>

          {tryout.assessors.length > 0 ? (
            <View>
              <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
                Scoring as
              </Text>
              <View className="flex-row flex-wrap">
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
                    />
                  );
                })}
              </View>
            </View>
          ) : null}

          <Input
            value={playerSearch}
            onChangeText={setPlayerSearch}
            placeholder="Search players by name"
            autoCapitalize="none"
          />

          <View>
            <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
              Show
            </Text>
            <View className="flex-row flex-wrap">
              {(['all', 'scored', 'unscored', 'skaters', 'goalies'] as const).map((f) => (
                <Chip
                  key={f}
                  label={f}
                  active={rosterFilter === f}
                  onPress={() => setRosterFilter(f)}
                />
              ))}
            </View>
          </View>

          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {tryout.roster.length} player{tryout.roster.length === 1 ? '' : 's'} · {scoredCount} scored
          </Text>
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
            <View className="flex-1 items-center justify-center px-6">
              <Text
                className="text-xl font-display font-bold text-center"
                style={{ color: colors.ink }}
              >
                Add your players to get started
              </Text>
              <Text className="text-sm text-center mt-2 mb-6" style={{ color: colors.inkMuted }}>
                Add players to this assessment, then you can start scoring.
              </Text>
              <Button label="+ Add Player" onPress={openAdd} className="w-full" />
            </View>
          )
        }
        renderItem={({ item }) => {
          const evalCount = evalCountByPlayerId.get(item.id) ?? 0;
          return (
            <Pressable
              onPress={() => {
                setCurrentPlayer(item.id);
                navigation.navigate('AssessmentFlow', { screen: 'AssessmentPlayer', params: { id: id, playerId: item.id } });
              }}
            >
              <View
                className="flex-row items-center gap-3 p-4 mb-2 rounded-lg border"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                <Avatar first={item.first} last={item.last} pos={item.pos} uri={item.avatarUrl} />
                <View className="flex-1">
                  <Text className="text-base font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(item)}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    #{item.jersey ?? '—'} · {item.pos ?? '—'}
                  </Text>
                </View>
                <View className="flex-row items-center justify-end gap-1">
                  {evalCount > 0 ? (
                    <Badge label={`${evalCount} eval${evalCount > 1 ? 's' : ''}`} variant="success" />
                  ) : (
                    <Badge label="Unscored" variant="warning" />
                  )}
                  {item.registrationSource === 'qr' ? <Badge label="QR" variant="info" /> : null}
                </View>
              </View>
            </Pressable>
          );
        }}
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
              desc: 'Import players from past seasons or other assessments.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRosterLibrary', params: { id: id } }),
            },
            {
              label: 'Scan Sheet Import',
              desc: 'Import scores from printed OCR scanning sheets.',
              go: () => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScanSheet', params: { id: id } }),
            },
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
            className="py-3 border-b"
            style={{ borderColor: colors.border }}
          >
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {t.label}
            </Text>
            <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
              {t.desc}
            </Text>
          </Pressable>
        ))}
      </Modal>

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
