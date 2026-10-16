import { useTerms } from '@/lib/terms';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
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
import { getPlayerCategories, getScoreHeatLevel, playerDisplayName } from '@/data/rubrics';
import { compareResultsBestFirst, formatMetricRaw, metricSummaries } from '@/data/scoring';
import { rosterPositionGroups } from '@/data/positions';
import { ScoredDonut } from '@/components/compare/ScoredDonut';
import { useSessionStore } from '@/state/sessionStore';

export default function ResultsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const setCurrentPlayer = useSessionStore((s) => s.setCurrentPlayer);
  const { data: tryout, results, isLoading, isError, refetch } = useResultsQuery(id);
  const terms = useTerms(tryout?.settings.customLabels, tryout?.sport);
  const [tab, setTab] = useState('overall');

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

  const sorted = [...results].sort(compareResultsBestFirst(tryout));
  const skaters = sorted.filter((r) => r.player.pos?.toUpperCase() !== 'GTL');
  const goalies = sorted.filter((r) => r.player.pos?.toUpperCase() === 'GTL');

  // The sport's own position groups (Defense for hockey, Infield for baseball...); a group nobody plays is left out.
  const inGroup = (r: (typeof sorted)[number], codes: string[]) => codes.includes((r.player.pos ?? '').trim().toUpperCase());
  const groups = rosterPositionGroups(tryout.sport, sorted.map((r) => r.player)).filter((g) =>
    sorted.some((r) => inGroup(r, g.codes)),
  );
  const activeGroup = groups.find((g) => g.key === tab);
  const visible = activeGroup ? sorted.filter((r) => inGroup(r, activeGroup.codes)) : sorted;
  const scoredResults = sorted.filter((r) => r.evalCount > 0);
  const ringColors = ['#FF6B2B', '#3B82F6', '#94A3B8', '#22C55E'];
  // One ring per skill the assessment defines (its rubric categories, skaters and goalies alike): the
  // share of the roster scored in it. Coverage stays 0-100 whatever scale a skill uses, and a skill
  // nobody has been scored in yet still gets its (empty) ring.
  const coverage = new Map<string, { label: string; n: number }>();
  for (const r of sorted) {
    for (const c of getPlayerCategories(tryout.sport, r.player.pos, tryout.settings.customRubrics)) {
      const cur = coverage.get(c.key) ?? { label: c.label, n: 0 };
      if (r.categoryScores[c.key] != null) cur.n += 1;
      coverage.set(c.key, cur);
    }
  }
  const rings = [...coverage.values()]
    .slice(0, ringColors.length)
    .map((c, i) => ({ label: c.label, pct: (c.n / Math.max(1, sorted.length)) * 100, color: ringColors[i] }));

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Evaluation Results" showBack />
      </View>
      <View className="px-4 py-3 gap-3">
        <View className="flex-row gap-2">
          <Button label="Builder" size="md" className="flex-1 px-1" textClassName="text-sm" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentTeamBuilder', params: { id: id } })} />
          <Button label="Compare" size="sm" variant="secondary" className="flex-1 px-1" textClassName="text-sm" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentCompare', params: { id: id } })} />
          {!isAssessorOnly && (
            <>
              <Button
                label="Export"
                size="md"
                variant="secondary"
                className="flex-1"
                textClassName="text-sm"
                onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentExport', params: { id: id } })}
              />
              <Button
                label="Import"
                size="md"
                variant="secondary"
                className="flex-1"
                textClassName="text-sm"
                onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScanSheet', params: { id: id, from: 'results' } })}
              />
            </>
          )}
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.player.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          sorted.length === 0 ? null : (
            <View className="gap-3 mb-3">
              {rings.length > 0 ? <ScoredDonut scored={scoredResults.length} total={sorted.length} rings={rings} /> : null}
              {groups.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8 }}
                >
                  {[{ key: 'overall', label: 'Overall' }, ...groups].map((g) => {
                    const on = tab === g.key;
                    return (
                      <Pressable
                        key={g.key}
                        onPress={() => setTab(g.key)}
                        accessibilityRole="button"
                        className="items-center justify-center px-5 py-3"
                        style={{
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: on ? colors.primary : colors.border,
                          backgroundColor: on ? colors.primary : colors.tile,
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: '700', color: on ? '#fff' : colors.ink }}>{g.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState
            title={sorted.length > 0 ? 'No players in this group' : 'No results yet'}
            message={sorted.length > 0 ? 'Pick another tab to see more players.' : terms.t('Score players to see the leaderboard.')}
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
              <Card className="mb-2 flex-row items-center gap-3" style={index === 0 ? { borderColor: colors.primary } : undefined}>
                <Text className="text-xl font-display font-bold text-center" style={{ width: 28, color: colors.inkMuted }}>
                  {index + 1}
                </Text>
                <Avatar first={item.player.first} last={item.player.last} pos={item.player.pos} size={40} uri={item.player.avatarUrl} />
                <View className="flex-1">
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(item.player)}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    #{item.player.jersey ?? '-'} · {item.player.pos ?? '-'}
                  </Text>
                  {(() => {
                    const metrics = metricSummaries(tryout, item.player);
                    if (!metrics.length) return null;
                    return (
                      <Text className="text-xs" numberOfLines={1} style={{ color: colors.inkMuted }}>
                        {metrics.map((m) => `${m.label} ${formatMetricRaw(m)}${m.capped ? ' (at max)' : ''}`).join(' · ')}
                      </Text>
                    );
                  })()}
                </View>
                <View className="items-end gap-1">
                  <Text className="text-xl font-display font-bold" style={{ color: heatColor }}>
                    {item.overall > 0 ? item.overall.toFixed(1) : '-'}
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
