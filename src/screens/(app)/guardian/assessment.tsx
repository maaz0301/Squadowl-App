import React from 'react';
import { View, Text, FlatList } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen, Header, Card, Badge, EmptyState, LoadingState, ErrorState } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useGuardianRostersQuery } from '@/features/queries';

export default function GuardianAssessmentDetailsScreen() {
  const route = useRoute<any>();
  const { playerId, tryoutId } = route.params || {};
  const colors = useThemeColors();
  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading evaluation details..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load evaluation details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a: any) => a.id === playerId);
  const tryout = athlete?.tryouts?.find((t: any) => t.id === tryoutId);

  if (!athlete || !tryout) {
    return (
      <Screen>
        <Header title="Evaluation Details" showBack />
        <EmptyState title="Not found" message="We couldn't find the details for this evaluation." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2">
        <Header title={tryout.name} showBack />
        <Text className="text-sm font-medium mb-4" style={{ color: colors.inkMuted }}>
          Evaluation Results · {tryout.sport}
        </Text>
      </View>

      <FlatList
        data={tryout.sessions || []}
        keyExtractor={(item: any, i: number) => item.name || i.toString()}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <EmptyState
            title="No sessions recorded"
            message="There are no evaluation results available yet for this tryout."
          />
        }
        renderItem={({ item: session }: { item: any }) => (
          <Card className="mb-4">
            <View className="flex-row items-center justify-between mb-3 border-b pb-3" style={{ borderBottomColor: colors.border }}>
              <Text className="text-lg font-bold" style={{ color: colors.ink }}>
                {session.name}
              </Text>
              <Badge 
                label={session.result || 'Pending'} 
                variant={session.result === 'Make' ? 'success' : session.result === 'Release' ? 'danger' : 'warning'} 
              />
            </View>
            
            {session.scores && Object.keys(session.scores).length > 0 ? (
              <View className="bg-black/5 dark:bg-white/5 rounded-md p-3">
                <Text className="text-xs font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>
                  Detailed Marks
                </Text>
                {Object.entries(session.scores).map(([key, value]) => (
                  <View key={key} className="flex-row justify-between items-center py-2 border-b border-black/5 dark:border-white/5 last:border-0">
                    <Text className="text-sm font-medium" style={{ color: colors.ink }}>{key}</Text>
                    <Text className="text-sm font-bold" style={{ color: colors.ink }}>{value as number}/5</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-sm italic" style={{ color: colors.inkMuted }}>
                No detailed marks recorded for this session.
              </Text>
            )}
          </Card>
        )}
      />
    </Screen>
  );
}
