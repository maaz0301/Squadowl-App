import { useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, EmptyState, Header, Input, Screen } from '@/components/ui';
import { HubIcon } from '@/components/teamHub/HubIcon';
import { HUB_ICONS } from '@/components/teamHub/hubTheme';
import {
  usePrefetchTryout,
  useSearchPlayersQuery,
  useSeasonsQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';
import { buildSearchIndex, runSearch, type SearchPlayer } from '@/data/search';
import { useSessionStore } from '@/state/sessionStore';

type Row =
  | { kind: 'header'; key: string; label: string; total: number }
  | { kind: 'evaluation'; key: string; id: string; name: string; sport: string }
  | { kind: 'player'; key: string; player: SearchPlayer }
  | { kind: 'season'; key: string; id: string; name: string; teamName: string }
  | { kind: 'more'; key: string; hidden: number };

const PAGE = 25;

export default function SearchScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
  const prefetchTryout = usePrefetchTryout();

  // Three independent reads, none of them blocking the screen. Evaluation names
  // come from the light list the dashboard has usually cached already, players
  // from a names-only read (no scores), seasons whenever they land — so the
  // search box is usable at once and each group fills in as its data arrives.
  const evaluationsQuery = useTryoutSummariesQuery(false);
  const playersQuery = useSearchPlayersQuery();
  const seasonsQuery = useSeasonsQuery();

  // Built once per data change, so a keystroke only does substring tests.
  const index = useMemo(
    () =>
      buildSearchIndex({
        evaluations: (evaluationsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name, sport: t.sport })),
        players: playersQuery.data,
        seasons: (seasonsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name, teamName: s.teamName })),
      }),
    [evaluationsQuery.data, playersQuery.data, seasonsQuery.data],
  );

  // The input stays instant; results follow on a deferred copy.
  const deferredQuery = useDeferredValue(query);
  const outcome = useMemo(() => runSearch(index, deferredQuery, limit), [index, deferredQuery, limit]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const { evaluations, players, seasons } = outcome;
    if (evaluations.items.length) {
      out.push({ kind: 'header', key: 'h-e', label: 'Evaluations', total: evaluations.total });
      evaluations.items.forEach((e) => out.push({ kind: 'evaluation', key: `e-${e.id}`, id: e.id, name: e.name, sport: e.sport }));
    }
    if (players.items.length) {
      out.push({ kind: 'header', key: 'h-p', label: 'Players', total: players.total });
      players.items.forEach((p) => out.push({ kind: 'player', key: `p-${p.id}`, player: p }));
    }
    if (seasons.items.length) {
      out.push({ kind: 'header', key: 'h-s', label: 'Seasons', total: seasons.total });
      seasons.items.forEach((s) => out.push({ kind: 'season', key: `s-${s.id}`, id: s.id, name: s.name, teamName: s.teamName }));
    }
    const hidden =
      evaluations.total - evaluations.items.length +
      (players.total - players.items.length) +
      (seasons.total - seasons.items.length);
    if (hidden > 0) out.push({ kind: 'more', key: 'more', hidden });
    return out;
  }, [outcome]);

  const hasQuery = deferredQuery.trim().length > 0;
  const stillLoading = playersQuery.isLoading || seasonsQuery.isLoading || evaluationsQuery.isLoading;
  const failed = playersQuery.isError || evaluationsQuery.isError;

  const open = (row: Row) => {
    if (row.kind === 'evaluation') {
      prefetchTryout(row.id);
      setCurrentTryout(row.id);
      setAssessorOnlyTryout(null);
      navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: row.id } });
    } else if (row.kind === 'player') {
      prefetchTryout(row.player.tryoutId);
      setCurrentTryout(row.player.tryoutId);
      setAssessorOnlyTryout(null);
      navigation.navigate('AssessmentFlow', {
        screen: 'AssessmentPlayer',
        params: { id: row.player.tryoutId, playerId: row.player.id },
      });
    } else if (row.kind === 'season') {
      navigation.navigate('SeasonDetail', { id: row.id });
    }
  };

  const chip = (icon: string) => (
    <View
      className="items-center justify-center rounded-md"
      style={{ width: 36, height: 36, backgroundColor: 'rgba(255,107,43,0.12)' }}
    >
      <HubIcon d={icon} size={20} color={colors.primary} />
    </View>
  );

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      return (
        <Text className="text-xs font-bold uppercase tracking-wider mt-3 mb-2" style={{ color: colors.inkMuted }}>
          {item.label} · {item.total}
        </Text>
      );
    }
    if (item.kind === 'more') {
      return (
        <Pressable onPress={() => setLimit((l) => l + 100)} className="py-3 items-center" hitSlop={8}>
          <Text className="text-sm font-bold" style={{ color: colors.primary }}>
            Show {Math.min(item.hidden, 100)} more ({item.hidden} left)
          </Text>
        </Pressable>
      );
    }

    const title =
      item.kind === 'player' ? `${item.player.first} ${item.player.last}`.trim() : item.name;
    const sub =
      item.kind === 'player'
        ? [item.player.jersey ? `#${item.player.jersey}` : null, item.player.pos, item.player.tryoutName]
            .filter(Boolean)
            .join(' · ')
        : item.kind === 'evaluation'
          ? item.sport
          : item.teamName;
    const icon =
      item.kind === 'player' ? HUB_ICONS.user : item.kind === 'season' ? HUB_ICONS.calendar : HUB_ICONS.clipboard;

    return (
      <Pressable onPress={() => open(item)}>
        <Card className="mb-2 flex-row items-center gap-3">
          {chip(icon)}
          <View className="flex-1">
            <Text className="font-display font-bold text-base" style={{ color: colors.ink }} numberOfLines={1}>
              {title}
            </Text>
            {sub ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </View>
          <HubIcon d={HUB_ICONS.chevron} size={16} color={colors.inkMuted} strokeWidth={2.5} />
        </Card>
      </Pressable>
    );
  };

  // What sits under the box: guidance, a loading line while a group is still
  // arriving, and the empty message only once everything has been searched.
  const status = (
    <View>
      {stillLoading ? (
        <View className="flex-row items-center gap-2 py-2">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Loading {playersQuery.isLoading ? 'players' : 'results'}… results appear as they load.
          </Text>
        </View>
      ) : null}
      {failed ? (
        <View className="flex-row items-center gap-2 py-2">
          <Text className="text-xs" style={{ color: colors.warning }}>
            Some results couldn’t be loaded.
          </Text>
          <Pressable
            onPress={() => {
              evaluationsQuery.refetch();
              playersQuery.refetch();
              seasonsQuery.refetch();
            }}
            hitSlop={8}
          >
            <Text className="text-xs font-bold" style={{ color: colors.primary }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Search" showBack />
        <Input
          label="Search evaluations, players, seasons"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setLimit(PAGE);
          }}
          placeholder="Tryout name, player, jersey #, team..."
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          rightAccessory={
            query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                <HubIcon d={HUB_ICONS.close} size={18} color={colors.inkMuted} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {!hasQuery ? (
        <View className="flex-1 px-4">
          {status}
          <EmptyState title="Start typing" message="Search across evaluations, players, jersey numbers and seasons." />
        </View>
      ) : rows.length === 0 && !stillLoading ? (
        <View className="flex-1 px-4">
          {status}
          <EmptyState title="No results" message={`Nothing matched "${deferredQuery.trim()}".`} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderRow}
          ListHeaderComponent={status}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          windowSize={7}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        />
      )}
    </Screen>
  );
}
