import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useImportLibraryPlayersMutation, useTryoutsQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { buildRosterLibrary } from '@/data/extras';

export default function RosterLibraryScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutsQuery = useTryoutsQuery(true);
  const importPlayers = useImportLibraryPlayersMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const library = useMemo(() => {
    if (!tryoutsQuery.data) return [];
    return buildRosterLibrary(tryoutsQuery.data, id);
  }, [tryoutsQuery.data, id]);

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading library..." />;
  if (tryoutsQuery.isError || !tryoutsQuery.data) {
    return (
      <Screen padded>
        <Header title="Roster Library" showBack />
        <ErrorState message="Could not load library." onRetry={() => tryoutsQuery.refetch()} />
      </Screen>
    );
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const importSelected = async () => {
    const entries = library
      .filter((e) => selected.has(e.key))
      .map((e) => ({ first: e.first, last: e.last, jersey: e.jersey, pos: e.pos }));
    if (!entries.length) return;
    await importPlayers.mutateAsync({ tryoutId: id!, entries });
    navigation.goBack();
  };

  return (
    <Screen padded={false}>
      <View className="px-4 py-3 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Roster Library
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          Import players from other assessments in your account.
        </Text>
        {selected.size > 0 ? (
          <Button
            label={`Import ${selected.size} player${selected.size > 1 ? 's' : ''}`}
            loading={importPlayers.isPending}
            onPress={importSelected}
          />
        ) : null}
      </View>
      <FlatList
        data={library}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState title="Library empty" message="Add players to other assessments first." />
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.key);
          return (
            <Pressable onPress={() => toggle(item.key)}>
              <Card className="mb-2 flex-row justify-between items-center" accent={isSelected}>
                <View>
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {item.first} {item.last}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    From {item.sourceTryoutName}
                  </Text>
                </View>
                <Badge label={isSelected ? 'Selected' : 'Tap to select'} variant={isSelected ? 'brand' : 'info'} />
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
