import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, Header, LoadingState, Screen } from '@/components/ui';
import { useRestoreTryoutMutation, useTryoutsQuery } from '@/features/queries';

export default function ArchivedAssessmentsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutsQuery = useTryoutsQuery(true);
  const restore = useRestoreTryoutMutation();

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading archived..." />;

  const archived = (tryoutsQuery.data ?? []).filter((t) => t.archived);

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Archived Assessments" showBack />
      </View>
      <FlatList
        data={archived}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState title="No archived assessments" message="Archived assessments appear here for restore." />
        }
        renderItem={({ item }) => (
          <Card className="mb-3 gap-2">
            <Pressable onPress={() => router.push(`/(app)/assessment/${item.id}/settings`)}>
              <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                {item.name}
              </Text>
              <Text className="text-sm mt-1" style={{ color: colors.inkMuted }}>
                {item.sport} · {item.roster.length} players
              </Text>
            </Pressable>
            <View className="flex-row gap-2 mt-2">
              <Badge label="Archived" variant="warning" />
              <Button
                label="Restore"
                size="sm"
                loading={restore.isPending}
                onPress={() => restore.mutate(item.id)}
              />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
