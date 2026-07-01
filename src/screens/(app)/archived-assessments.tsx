import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useRestoreTryoutMutation, useTryoutsQuery } from '@/features/queries';

export default function ArchivedAssessmentsScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutsQuery = useTryoutsQuery(true);
  const restore = useRestoreTryoutMutation();

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading archived..." />;
  if (tryoutsQuery.isError) {
    return (
      <Screen padded>
        <Header title="Archived Assessments" showBack />
        <ErrorState
          message="Could not load archived assessments."
          onRetry={() => tryoutsQuery.refetch()}
        />
      </Screen>
    );
  }

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
            <Pressable onPress={() => navigation.navigate('AssessmentSettings', { id: item.id })}>
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
