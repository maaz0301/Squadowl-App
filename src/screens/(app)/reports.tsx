import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { HomePanel, PanelRow } from '@/components/home/HomePanel';
import { HubIcon } from '@/components/teamHub/HubIcon';
import { HUB_ICONS } from '@/components/teamHub/hubTheme';
import { useTeamsQuery, useTryoutsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import {
  buildReportSummary,
  filterTryoutsByTeam,
  listReportRubrics,
  listReportTeams,
  topPerformersByRubric,
  REPORT_RECOMMENDATIONS,
  type EvaluationReportRow,
  type ReportRecommendation,
} from '@/data/reports';

/** An evaluation card before its scores have loaded. */
type PendingRow = Pick<EvaluationReportRow, 'id' | 'name' | 'sport' | 'eventType' | 'date' | 'players'> & {
  pending: true;
};
type ListRow = EvaluationReportRow | PendingRow;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const score = (n: number | null) => (n === null ? '-' : n.toFixed(1));

/** Insights across the coach's evaluations: progress, scoring, leaders and the calls made. */
export default function ReportsScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
  // Two reads, started together. The light one (names, sports, headcounts — the
  // dashboard has usually cached it already) paints the page straight away; the
  // heavy one carries every evaluation and score and fills in the numbers when it
  // lands. Waiting on the heavy one alone left a blank spinner for many seconds.
  const summariesQuery = useTryoutSummariesQuery(false);
  const tryoutsQuery = useTryoutsQuery(false);

  const refreshControl = usePullToRefresh(() => Promise.all([summariesQuery.refetch(), tryoutsQuery.refetch()]));

  const scoresReady = !!tryoutsQuery.data;
  const summary = useMemo(() => buildReportSummary(tryoutsQuery.data ?? []), [tryoutsQuery.data]);

  // Top performers can be ranked on the overall score or on any one measure.
  const [leaderFocus, setLeaderFocus] = useState('overall');
  // ...and limited to one team's evaluations, or left on everyone.
  const [leaderTeam, setLeaderTeam] = useState<string | null>(null);
  const teamsQuery = useTeamsQuery();
  const teamOptions = useMemo(
    () => listReportTeams(tryoutsQuery.data ?? [], teamsQuery.data ?? []),
    [tryoutsQuery.data, teamsQuery.data],
  );
  const leaderTryouts = useMemo(() => filterTryoutsByTeam(tryoutsQuery.data ?? [], leaderTeam), [tryoutsQuery.data, leaderTeam]);
  const rubricOptions = useMemo(() => listReportRubrics(leaderTryouts), [leaderTryouts]);
  const focusRubric = rubricOptions.find((r) => r.key === leaderFocus);
  const leaders = useMemo(
    () =>
      focusRubric
        ? topPerformersByRubric(leaderTryouts, focusRubric.key)
        : buildReportSummary(leaderTryouts).topPerformers.map((p) => ({ ...p, unit: undefined as string | undefined })),
    [focusRubric, leaderTryouts],
  );
  const leaderValue = (n: number, unit?: string) =>
    !focusRubric
      ? score(n)
      : unit
        ? `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} ${unit}`
        : n.toFixed(1);

  // Until the scores arrive the list is built from the light read: same cards,
  // same buttons, no progress figures.
  const rows: ListRow[] = useMemo(() => {
    if (scoresReady) return summary.rows;
    return [...(summariesQuery.data ?? [])]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({
        pending: true as const,
        id: t.id,
        name: t.name,
        sport: t.sport,
        eventType: t.eventType,
        date: t.tryoutDate ?? null,
        players: t.playerCount,
      }));
  }, [scoresReady, summary.rows, summariesQuery.data]);
  const evaluationCount = scoresReady ? summary.evaluationCount : rows.length;

  // Same colours the app already uses for these calls; grey for "no call yet".
  const recColor: Record<ReportRecommendation, string> = {
    Make: colors.success,
    Keep: colors.info,
    Bubble: colors.warning,
    Release: colors.danger,
    Undecided: colors.inkFaint,
  };

  if (summariesQuery.isLoading && !scoresReady) return <LoadingState message="Building reports..." />;
  if (summariesQuery.isError && !scoresReady) {
    return (
      <Screen scroll>
        <Header title="Reports" showBack />
        <ErrorState
          message="Could not load your evaluations."
          onRetry={() => {
            summariesQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  const open = (id: string, screen: 'AssessmentResults' | 'AssessmentCompare' | 'AssessmentExport') => {
    setCurrentTryout(id);
    setAssessorOnlyTryout(null);
    navigation.navigate('AssessmentFlow', { screen, params: { id } });
  };

  const scoresFailed = tryoutsQuery.isError && !scoresReady;
  const waiting = scoresFailed ? 'unavailable' : 'calculating…';
  const kpis = [
    { label: 'Evaluations', value: `${evaluationCount}`, caption: 'in your account' },
    {
      label: 'Players scored',
      value: scoresReady ? `${summary.scoredPlayerCount}` : '-',
      caption: scoresReady ? `of ${summary.playerCount} · ${pct(summary.completion)}` : waiting,
    },
    {
      label: 'Scores recorded',
      value: scoresReady ? `${summary.scoresRecorded}` : '-',
      caption: scoresReady ? 'evaluations entered' : waiting,
    },
    {
      label: 'Average score',
      value: scoresReady ? score(summary.avgOverall) : '-',
      caption: scoresReady ? 'out of 5' : waiting,
    },
  ];
  const calculating = (
    <View className="flex-row items-center gap-2">
      {scoresFailed ? null : <ActivityIndicator size="small" color={colors.primary} />}
      <Text className="text-sm" style={{ color: colors.inkMuted }}>
        {scoresFailed ? 'Could not calculate scores. ' : 'Calculating from your scores…'}
      </Text>
      {scoresFailed ? (
        <Pressable onPress={() => tryoutsQuery.refetch()} hitSlop={8}>
          <Text className="text-sm font-bold" style={{ color: colors.primary }}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const recTotal = REPORT_RECOMMENDATIONS.reduce((n, r) => n + summary.recommendations[r], 0);

  const header = (
    <View>
      <View className="flex-row flex-wrap gap-3 mb-6">
        {kpis.map((k) => (
          <Card key={k.label} className="gap-1" style={{ width: '48%', flexGrow: 1 }}>
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              {k.label}
            </Text>
            <Text className="font-display font-bold" style={{ fontSize: 28, color: colors.ink }}>
              {k.value}
            </Text>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {k.caption}
            </Text>
          </Card>
        ))}
      </View>

      <View className="mb-6">
        <HomePanel icon={HUB_ICONS.chart} label="Recommendations">
          {!scoresReady ? (
            calculating
          ) : recTotal === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No players scored yet. Calls appear here as coaches recommend Make, Keep, Bubble or Release.
            </Text>
          ) : (
            <View className="gap-3">
              <View className="flex-row overflow-hidden rounded-full" style={{ height: 10 }}>
                {REPORT_RECOMMENDATIONS.filter((r) => summary.recommendations[r] > 0).map((r) => (
                  <View key={r} style={{ flex: summary.recommendations[r], backgroundColor: recColor[r] }} />
                ))}
              </View>
              <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 8 }}>
                {REPORT_RECOMMENDATIONS.map((r) => (
                  <View key={r} className="flex-row items-center gap-1.5">
                    <View className="rounded-full" style={{ width: 8, height: 8, backgroundColor: recColor[r] }} />
                    <Text className="text-sm" style={{ color: colors.ink }}>
                      {r} <Text style={{ color: colors.inkMuted }}>{summary.recommendations[r]}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </HomePanel>
      </View>

      <View className="mb-6">
        <HomePanel icon={HUB_ICONS.user} label="Top performers">
          {!scoresReady ? (
            calculating
          ) : summary.topPerformers.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Leaders appear once players have been scored.
            </Text>
          ) : (
            <View className="gap-2">
              {teamOptions.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Chip label="All teams" active={!leaderTeam} onPress={() => setLeaderTeam(null)} />
                  {teamOptions.map((t) => (
                    <Chip key={t.id} label={t.name} active={leaderTeam === t.id} onPress={() => setLeaderTeam(t.id)} />
                  ))}
                </ScrollView>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Chip label="Overall" active={!focusRubric} onPress={() => setLeaderFocus('overall')} />
                {rubricOptions.map((r) => (
                  <Chip
                    key={r.key}
                    label={r.label}
                    active={focusRubric?.key === r.key}
                    onPress={() => setLeaderFocus(r.key)}
                  />
                ))}
              </ScrollView>
              {leaders.length === 0 ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  No scored players for this team yet.
                </Text>
              ) : null}
              {leaders.map((p, i) => (
                <Pressable
                  key={`${p.evaluationId}-${p.playerId}`}
                  onPress={() => {
                    setCurrentTryout(p.evaluationId);
                    setAssessorOnlyTryout(null);
                    navigation.navigate('AssessmentFlow', {
                      screen: 'AssessmentPlayer',
                      params: { id: p.evaluationId, playerId: p.playerId },
                    });
                  }}
                >
                  <PanelRow>
                    <View
                      className="items-center justify-center rounded-full"
                      style={{ width: 28, height: 28, backgroundColor: i === 0 ? colors.primary : colors.tile }}
                    >
                      <Text className="text-xs font-bold" style={{ color: i === 0 ? '#ffffff' : colors.inkMuted }}>
                        {i + 1}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-base font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                        {p.evaluationName}
                        {p.pos ? ` · ${p.pos}` : ''}
                      </Text>
                    </View>
                    <Badge label={leaderValue(p.overall, p.unit)} variant="brand" />
                  </PanelRow>
                </Pressable>
              ))}
            </View>
          )}
        </HomePanel>
      </View>

      <Text className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: colors.inkMuted }}>
        By evaluation
      </Text>
    </View>
  );

  const renderRow = ({ item }: { item: ListRow }) =>
    'pending' in item ? renderPendingRow(item) : renderScoredRow(item);

  const renderButtons = (id: string) => (
    <View className="flex-row gap-2">
      <Button label="Results" size="sm" className="flex-1" onPress={() => open(id, 'AssessmentResults')} />
      <Button label="Compare" size="sm" variant="secondary" className="flex-1" onPress={() => open(id, 'AssessmentCompare')} />
      <Button label="Export" size="sm" variant="secondary" className="flex-1" onPress={() => open(id, 'AssessmentExport')} />
    </View>
  );

  const renderPendingRow = (item: PendingRow) => (
    <Card className="mb-3 gap-3">
      <View>
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }} numberOfLines={2}>
          {item.name}
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {item.sport} · {item.eventType}
          {item.date ? ` · ${item.date}` : ''} · {item.players} {item.players === 1 ? 'player' : 'players'}
        </Text>
      </View>
      <Text className="text-xs" style={{ color: colors.inkMuted }}>
        {scoresFailed ? 'Scores unavailable' : 'Loading scores…'}
      </Text>
      {renderButtons(item.id)}
    </Card>
  );

  const renderScoredRow = (item: EvaluationReportRow) => (
    <Card className="mb-3 gap-3">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-lg font-display font-bold" style={{ color: colors.ink }} numberOfLines={2}>
            {item.name}
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {item.sport} · {item.eventType}
            {item.date ? ` · ${item.date}` : ''}
          </Text>
        </View>
        <Badge label={`Avg ${score(item.avgOverall)}`} variant={item.avgOverall === null ? 'default' : 'brand'} />
      </View>

      <View className="gap-1.5">
        <View className="rounded-full overflow-hidden" style={{ height: 8, backgroundColor: colors.tile }}>
          <View style={{ width: `${Math.round(item.completion * 100)}%`, height: 8, backgroundColor: colors.primary }} />
        </View>
        <View className="flex-row justify-between">
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            {item.scoredPlayers} of {item.players} {item.players === 1 ? 'player' : 'players'} scored · {pct(item.completion)}
          </Text>
          {item.unscored > 0 ? (
            <Text className="text-xs font-bold" style={{ color: colors.warning }}>
              {item.unscored} to go
            </Text>
          ) : item.players > 0 ? (
            <Text className="text-xs font-bold" style={{ color: colors.success }}>
              Complete
            </Text>
          ) : null}
        </View>
        {item.top ? (
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Leader: <Text style={{ color: colors.ink }}>{item.top.name}</Text> · {score(item.top.overall)}
          </Text>
        ) : null}
      </View>

      {renderButtons(item.id)}
    </Card>
  );

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Reports" subtitle="Insights across your evaluations" showBack />
      </View>
      {evaluationCount === 0 ? (
        <EmptyState
          title="No evaluations yet"
          message="Create an evaluation and score players to see progress, leaders and recommendations here."
          actionLabel="Go to Evaluations"
          onAction={() => navigation.navigate('DashboardMain', { tab: 'assessments' })}
        />
      ) : (
        <FlatList
          data={rows}
          refreshControl={refreshControl}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        />
      )}
    </Screen>
  );
}
