import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { themeTokens } from '@/theme/tokens';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Screen,
} from '@/components/ui';
import { useResultsQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getScoreHeatLevel, playerDisplayName } from '@/data/rubrics';

export default function ResultsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const { data: tryout, results, assessorProgress, isLoading, isError, refetch } = useResultsQuery(id);

  if (isLoading) return <LoadingState message="Loading results..." />;
  if (isError || !tryout) {
    return <ErrorState message="Could not load results." onRetry={() => refetch()} />;
  }

  const sorted = [...results].sort((a, b) => b.overall - a.overall);
  const skaters = sorted.filter((r) => r.player.pos?.toUpperCase() !== 'GTL');
  const goalies = sorted.filter((r) => r.player.pos?.toUpperCase() === 'GTL');

  return (
    <Screen padded={false}>
      <Header title="Assessment Results" showBack />
      <View className="px-4 py-3 gap-3">
        <Card className="gap-2">
          <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
            Assessor Progress
          </Text>
          {assessorProgress.map((a, i) => (
            <View key={`${a.name}-${i}`} className="flex-row justify-between">
              <Text style={{ color: colors.inkMuted }}>{a.name}</Text>
              <Text className="font-bold" style={{ color: colors.ink }}>
                {a.scored}/{a.total}
              </Text>
            </View>
          ))}
        </Card>
        <View className="flex-row flex-wrap gap-2">
          <Button label="Team Builder" size="sm" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: id } })} />
          <Button label="Compare" size="sm" variant="secondary" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentCompare', params: { id: id } })} />
          <Button label="Export" size="sm" variant="secondary" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentExport', params: { id: id } })} />
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.player.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          sorted.length === 0 ? null : (
            <View className="flex-row gap-2 mb-3">
              <Badge label={`${skaters.length} Skaters`} variant="brand" />
              <Badge label={`${goalies.length} Goalies`} variant="info" />
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState
            title="No results yet"
            message="Score players to see the leaderboard."
          />
        }
        renderItem={({ item, index }) => {
          const heat = getScoreHeatLevel(item.overall);
          const heatColor = themeTokens.scoreColors[heat];
          return (
            <Card className="mb-2 flex-row items-center gap-3">
              <Text className="text-xl font-display font-bold w-8" style={{ color: colors.inkMuted }}>
                {index + 1}
              </Text>
              <Avatar first={item.player.first} last={item.player.last} pos={item.player.pos} size={40} />
              <View className="flex-1">
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {playerDisplayName(item.player)}
                </Text>
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  #{item.player.jersey ?? '—'} · {item.player.pos ?? '—'}
                </Text>
              </View>
              <View className="items-end gap-1">
                <Text className="text-xl font-display font-bold" style={{ color: heatColor }}>
                  {item.overall > 0 ? item.overall.toFixed(1) : '—'}
                </Text>
                {item.latestRecommendation ? (
                  <Badge
                    label={item.latestRecommendation}
                    variant={
                      item.latestRecommendation === 'Make'
                        ? 'success'
                        : item.latestRecommendation === 'Release'
                          ? 'danger'
                          : 'default'
                    }
                  />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
