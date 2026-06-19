import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Screen,
} from '@/components/ui';
import { useTryoutQuery, useAddPlayerMutation, useImportLibraryPlayersMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { playerDisplayName } from '@/data/rubrics';
import { isAtPlayerLimit } from '@/data/plans';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';

export default function RosterScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutQuery = useTryoutQuery(id);
  const addPlayer = useAddPlayerMutation(id!);
  const rosterFilter = useSessionStore((s) => s.rosterFilter);
  const setRosterFilter = useSessionStore((s) => s.setRosterFilter);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const user = useUser();
  const importLibrary = useImportLibraryPlayersMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState('');

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

  const parseCsv = async () => {
    const lines = csvText.split('\n').map((l) => l.trim()).filter(Boolean);
    const entries = lines.map((line) => {
      const [first, last, jersey, pos] = line.split(',').map((s) => s.trim());
      return { first: first ?? '', last: last ?? '', jersey, pos };
    }).filter((e) => e.first && e.last);
    if (!entries.length) return;
    await importLibrary.mutateAsync({ tryoutId: id!, entries });
    setCsvText('');
    setShowCsv(false);
  };

  const openAdd = () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
      router.push('/(app)/upgrade');
      return;
    }
    setShowAdd(true);
  };

  return (
    <Screen padded={false}>
      <View className="px-4 py-3">
        {tryout.assessors.length > 0 ? (
          <View className="mb-2">
            <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
              Active Assessor
            </Text>
            <View className="flex-row flex-wrap">
              {tryout.assessors.map((a) => (
                <Chip
                  key={a.name}
                  label={a.name}
                  active={activeAssessor === a.name}
                  onPress={() => setActiveAssessor(activeAssessor === a.name ? null : a.name)}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View className="flex-row flex-wrap">
          {(['all', 'scored', 'unscored', 'skaters', 'goalies'] as const).map((f) => (
            <Chip key={f} label={f} active={rosterFilter === f} onPress={() => setRosterFilter(f)} />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2 mt-3">
          <Button label="Rinkside Score" size="sm" onPress={() => router.push(`/(app)/assessment/${id}/rinkside`)} />
          <Button label="Sort Out" size="sm" variant="secondary" onPress={() => router.push(`/(app)/assessment/${id}/team-builder`)} />
          <Button label="+ Add Player" size="sm" variant="secondary" onPress={openAdd} />
          <Button label="Library" size="sm" variant="ghost" onPress={() => router.push(`/(app)/assessment/${id}/roster-library`)} />
          <Button label="CSV Import" size="sm" variant="ghost" onPress={() => setShowCsv(true)} />
          <Button label="Scan Sheet" size="sm" variant="ghost" onPress={() => router.push(`/(app)/assessment/${id}/scan-sheet`)} />
        </View>
      </View>

      <FlatList
        data={filteredRoster}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            title="No players yet"
            message="Add players manually or via QR registration."
            actionLabel="Add Player"
            onAction={openAdd}
          />
        }
        renderItem={({ item }) => {
          const evalCount = tryout.evals.filter((e) => e.playerId === item.id).length;
          return (
            <Pressable
              onPress={() => {
                setCurrentPlayer(item.id);
                router.push(`/(app)/assessment/${id}/player/${item.id}`);
              }}
            >
              <View
                className="flex-row items-center gap-3 p-4 mb-2 rounded-lg border"
                style={{ backgroundColor: colors.card, borderColor: colors.border }}
              >
                <Avatar first={item.first} last={item.last} pos={item.pos} />
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
          loading={addPlayer.isPending}
          onSubmit={async (data) => {
            await addPlayer.mutateAsync(data);
            setShowAdd(false);
          }}
        />
      </Modal>

      <Modal visible={showCsv} title="CSV Import" onClose={() => setShowCsv(false)}>
        <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
          One player per line: first,last,jersey,pos
        </Text>
        <Input
          label="CSV data"
          value={csvText}
          onChangeText={setCsvText}
          multiline
          numberOfLines={6}
          placeholder="Alex,Smith,12,FWD"
        />
        <Button label="Import" onPress={parseCsv} loading={importLibrary.isPending} className="mt-2" />
      </Modal>
    </Screen>
  );
}
