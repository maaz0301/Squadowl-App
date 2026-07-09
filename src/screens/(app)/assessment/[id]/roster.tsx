import { useMemo, useState, useEffect } from 'react';
import { FlatList, Pressable, Text, View, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Modal,
  Screen,
} from '@/components/ui';
import { useTryoutQuery, useAddPlayerMutation, useUploadPlayerPhotoMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { playerDisplayName } from '@/data/rubrics';
import { isAtPlayerLimit } from '@/data/plans';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { LimitReachedModal } from '@/components/LimitReachedModal';

export default function RosterScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const [showAdd, setShowAdd] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

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

  const filteredRoster = useMemo(() => {
    if (!tryoutQuery.data) return [];
    const { roster, evals } = tryoutQuery.data;
    const scoredIds = new Set(evals.map((e) => e.playerId));
    switch (rosterFilter) {
      case 'scored':
        return roster.filter((p) => scoredIds.has(p.id));
      case 'unscored':
        return roster.filter((p) => !scoredIds.has(p.id));
      case 'goalies':
        return roster.filter((p) => p.pos?.toUpperCase() === 'GTL');
      case 'skaters':
        return roster.filter((p) => p.pos?.toUpperCase() !== 'GTL');
      default:
        return roster;
    }
  }, [tryoutQuery.data, rosterFilter]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;

  const openAdd = () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
      setLimitMsg('You have reached the maximum number of players for your current plan.');
      return;
    }
    setShowAdd(true);
  };

  const hasPlayers = tryout.roster.length > 0;
  const scoredCount = new Set(tryout.evals.map((e) => e.playerId)).size;

  return (
    <Screen padded={false}>
      <Header title="Assessment Roster" showBack />
      {hasPlayers ? (
        <View className="px-4 pt-2 pb-3 gap-3">
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
        ListEmptyComponent={
          hasPlayers ? (
            <EmptyState
              title="No players match this filter"
              message={`No ${rosterFilter} players. Try a different filter.`}
              actionLabel="Show all"
              onAction={() => setRosterFilter('all')}
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
          const evalCount = tryout.evals.filter((e) => e.playerId === item.id).length;
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
                <View className="items-end gap-1">
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
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
