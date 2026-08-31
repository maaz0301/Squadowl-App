import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

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
import { useSessionStore } from '@/state/sessionStore';

export default function ResultsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const { data: tryout, results, isLoading, isError, refetch } = useResultsQuery(id);

  const parentState = navigation.getParent()?.getState();
  const flowRoute = parentState?.routes?.find((r: any) => r.name === 'AssessmentFlow');
  const isAssessorOnly =
    route.params?.isAssessorOnly ||
    flowRoute?.params?.isAssessorOnly ||
    flowRoute?.params?.params?.isAssessorOnly ||
    false;

  if (isLoading) return <LoadingState message="Loading results..." />;
  if (isError || !tryout) {
    return <ErrorState message="Could not load results." onRetry={() => refetch()} />;
  }

  const sorted = [...results].sort((a, b) => b.overall - a.overall);
  const skaters = sorted.filter((r) => r.player.pos?.toUpperCase() !== 'GTL');
  const goalies = sorted.filter((r) => r.player.pos?.toUpperCase() === 'GTL');

  return (
    <Screen padded={false}>
      <Header title="Evaluation Results" showBack />
      <View className="px-4 py-3 gap-3">
        <View className="flex-row flex-wrap gap-2 items-center">
          <Button label="Team Builder" size="sm" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: id } })} />
          <Button label="Compare" size="sm" variant="secondary" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentCompare', params: { id: id } })} />
          {!isAssessorOnly && (
            <Button
              label="Export"
              size="sm"
              variant="secondary"
              onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentExport', params: { id: id } })}
            />
          )}
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
            <Pressable
              onPress={() => {
                setCurrentPlayer(item.player.id);
                navigation.navigate('AssessmentFlow', { screen: 'AssessmentPlayer', params: { id: id, playerId: item.player.id, from: 'results' } });
              }}
            >
              <Card className="mb-2 flex-row items-center gap-3">
                <Text className="text-xl font-display font-bold w-8" style={{ color: colors.inkMuted }}>
                  {index + 1}
                </Text>
                <Avatar first={item.player.first} last={item.player.last} pos={item.player.pos} size={40} uri={item.player.avatarUrl} />
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
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
