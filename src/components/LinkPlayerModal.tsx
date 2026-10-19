import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { Avatar, Badge, Button, Input, Modal } from '@/components/ui';
import { foldAthletes } from '@/data/duplicates';
import { playerDisplayName } from '@/data/rubrics';
import { useAthleteHubQuery, useAthleteLinksQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Pick players already in the account (from other teams, seasons and
 * evaluations) to link to this team or evaluation. A linked player is the same
 * person, not a copy: their profile and full history show everywhere they are linked.
 */
export function LinkPlayerModal({
  visible,
  title = 'Link Player',
  where,
  linkedAthleteIds,
  linking,
  onClose,
  onLink,
}: {
  visible: boolean;
  title?: string;
  /** Names the destination in messages: "this team", "this evaluation". */
  where: string;
  /** Athlete ids already linked here. */
  linkedAthleteIds: ReadonlySet<string>;
  linking: boolean;
  onClose: () => void;
  onLink: (athleteIds: string[]) => void;
}) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  // Start fresh each time it opens: reset while rendering, the supported way to adjust state when a prop changes.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setQuery('');
      setSearch('');
      setSelected(new Set());
      setNotice(null);
    }
  }

  const hubQuery = useAthleteHubQuery(search);
  const athletes = useMemo(() => foldAthletes(hubQuery.data?.pages.flatMap((p) => p.rows) ?? []), [hubQuery.data]);
  const linksQuery = useAthleteLinksQuery(athletes.flatMap((a) => [a.id, ...a.alsoIds]));

  const isLinked = (a: { id: string; alsoIds: string[] }) =>
    linkedAthleteIds.has(a.id) || a.alsoIds.some((id) => linkedAthleteIds.has(id));

  const toggle = (a: (typeof athletes)[number]) => {
    const name = playerDisplayName(a);
    if (isLinked(a)) {
      setNotice(`${name} is already linked to ${where}.`);
      return;
    }
    setNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(a.id)) next.delete(a.id);
      else next.add(a.id);
      return next;
    });
  };

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={onClose}
      scroll={false}
      footer={
        <Button
          label={selected.size > 0 ? `Link ${selected.size} player${selected.size === 1 ? '' : 's'}` : 'Select players to link'}
          disabled={selected.size === 0}
          loading={linking}
          onPress={() => onLink([...selected])}
        />
      }
    >
      <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
        Pick players from your other teams and evaluations. They stay one player with one history.
      </Text>
      <Input placeholder="Search by name or guardian" value={query} onChangeText={setQuery} autoCapitalize="none" />
      {notice ? (
        <Text className="text-sm mt-2 font-bold" style={{ color: colors.warning }} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {hubQuery.isLoading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      ) : (
        <FlatList
          style={{ maxHeight: 360, marginTop: 8 }}
          data={athletes}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => {
            if (hubQuery.hasNextPage && !hubQuery.isFetchingNextPage) void hubQuery.fetchNextPage();
          }}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <Text className="text-sm py-6 text-center" style={{ color: colors.inkMuted }}>
              {search ? 'No players match that search.' : 'No other players to link yet.'}
            </Text>
          }
          ListFooterComponent={hubQuery.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
          renderItem={({ item }) => {
            const linked = isLinked(item);
            const on = selected.has(item.id);
            const links = [item.id, ...item.alsoIds].flatMap((id) => linksQuery.data?.[id]?.teams ?? []);
            const teamNames = [...new Set(links.map((t) => t.name))];
            return (
              <Pressable
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: linked }}
                className="flex-row items-center gap-3 py-2 border-b"
                style={{ borderColor: colors.border, opacity: linked ? 0.55 : 1 }}
              >
                <View
                  className="items-center justify-center rounded"
                  style={{
                    width: 22,
                    height: 22,
                    borderWidth: 2,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : 'transparent',
                  }}
                >
                  {on ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                </View>
                <Avatar first={item.first} last={item.last} pos={item.currentPosition} size={36} uri={item.avatarUrl} />
                <View className="flex-1">
                  <Text className="font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                    {playerDisplayName(item)}
                  </Text>
                  <Text className="text-xs" numberOfLines={1} style={{ color: colors.inkMuted }}>
                    {[item.yearOfBirth, item.currentPosition, teamNames.length ? `On ${teamNames.join(', ')}` : '']
                      .filter(Boolean)
                      .join(' · ') || 'Player'}
                  </Text>
                </View>
                {linked ? <Badge label="Linked" /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Modal>
  );
}
