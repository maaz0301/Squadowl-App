import { useState } from 'react';
import { Alert, Pressable, Share, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Screen,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useTryoutQuery,
  useExportTryoutMutation,
  useShareLinkMutation,
  usePlatformBlockedFeaturesQuery,
  useTeamsQuery,
} from '@/features/queries';
import {
  compactMetricCapacity,
  DEFAULT_REPORT_CONTENT,
  PLAYERS_PER_PAGE_OPTIONS,
  reportLogoUrls,
  type PlayersPerPage,
  type ReportContent,
  type ReportLayout,
} from '@/lib/reportPdf';
import {
  buildPlayerFullResults,
  isReportFilterActive,
  reportFilterChoices,
  reportSortOptions,
  type ReportFilter,
  type ReportSort,
} from '@/data/resultsExport';
import { useAssessmentId } from '@/features/useAssessmentId';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import type { ExportFormat } from '@/data/types';
import { nextFrame } from '@/lib/nextFrame';
import { useUser } from '@/state/authStore';

export default function ExportScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const exportMut = useExportTryoutMutation(id!);
  const shareMut = useShareLinkMutation(id!);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [playersPerPage, setPlayersPerPage] = useState<PlayersPerPage>(1);
  const [continuous, setContinuous] = useState(false);
  const [sortBy, setSortBy] = useState<ReportSort>('jersey');
  const [printLogo, setPrintLogo] = useState(true);
  const [printAppLogo, setPrintAppLogo] = useState(true);
  const [layout, setLayout] = useState<ReportLayout>('cards');
  const [content, setContent] = useState<ReportContent>(DEFAULT_REPORT_CONTENT);
  const [topX, setTopX] = useState('');
  const [minScore, setMinScore] = useState('');
  const [scoredOnly, setScoredOnly] = useState(false);
  const [positions, setPositions] = useState<string[]>([]);
  const [birthYears, setBirthYears] = useState<string[]>([]);
  // The team's own logo, for club accounts. A hook, so it runs before the
  // loading/error guards below.
  const teamsQuery = useTeamsQuery();
  const exportTeam = teamsQuery.data?.find((t) => t.id === tryoutQuery.data?.teamId);
  const teamLogoUrl = exportTeam?.logoUrl;
  const teamName = exportTeam?.name;
  const organizationLogoUrl = useUser()?.organizationLogoUrl;
  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;
  // Logos on the printed report are a Club-plan touch.
  const clubMode = tier === 'club';

  const choices = reportFilterChoices(tryout);
  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const setContentFlag = (key: keyof ReportContent) => (on: boolean) => setContent((c) => ({ ...c, [key]: on }));

  /** Only the filters the coach actually set; blank or invalid numbers are ignored. */
  const top = parseInt(topX, 10);
  const min = parseFloat(minScore);
  const filter: ReportFilter = {
    topX: Number.isFinite(top) && top > 0 ? top : undefined,
    minScore: Number.isFinite(min) ? min : undefined,
    scoredOnly: scoredOnly || undefined,
    positions: positions.length ? positions : undefined,
    birthYears: birthYears.length ? birthYears : undefined,
  };
  const filterActive = isReportFilterActive(filter);
  const matchCount = buildPlayerFullResults(tryout, sortBy, filter, teamName).length;
  const singlePage = layout === 'cards' && playersPerPage === 1;
  // Several-per-page cards only have room for so many rubric rows; the rest print as "+N more".
  const mostRubrics = Math.max(
    0,
    ...buildPlayerFullResults(tryout, sortBy, filter, teamName).map((c) => c.metrics.length),
  );
  const cardCapacity =
    layout === 'cards' && playersPerPage !== 1 && content.rubricScores
      ? compactMetricCapacity(
          playersPerPage as Exclude<PlayersPerPage, 1>,
          reportLogoUrls({
            club: clubMode,
            organizationLogoUrl: printLogo ? organizationLogoUrl : undefined,
            teamLogoUrl: printLogo ? teamLogoUrl : undefined,
            appLogo: printAppLogo,
          }).length > 0,
          content,
        )
      : null;
  const rubricsCutOff = cardCapacity !== null && mostRubrics > cardCapacity;

  const handleExport = async (format: ExportFormat) => {
    if (matchCount === 0) {
      Alert.alert('No players match', 'Loosen the filters so at least one player is included.');
      return;
    }
    setIsExporting(format);
    try {
      await nextFrame();
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(
        tryout,
        format,
        format === 'pdf'
          ? {
              playersPerPage,
              continuous: continuous && playersPerPage === 1 && layout === 'cards',
              logoUrls: reportLogoUrls({
                club: clubMode,
                organizationLogoUrl: printLogo ? organizationLogoUrl : undefined,
                teamLogoUrl: printLogo ? teamLogoUrl : undefined,
                appLogo: printAppLogo,
              }),
              sortBy,
              filter,
              content,
              layout,
              teamName,
            }
          : { sortBy, filter, teamName },
      );
    } catch (e: any) {
      console.error(e);
      Alert.alert('Export Failed', e?.message || `Could not export the ${format.toUpperCase()}.`);
    } finally {
      setIsExporting(null);
    }
  };

  const lockedFormat = (label: string, format: string, requiredPlan: string) => (
    <Card key={format} accent className="gap-2">
      <Text className="font-display font-bold" style={{ color: colors.ink }}>
        {label}
      </Text>
      <Text style={{ color: colors.inkMuted }}>
        Requires the {requiredPlan} plan or higher. You're on {tier}.
      </Text>
      {!billingBlocked ? <Button label="View Plans" onPress={() => navigation.navigate('Upgrade')} /> : null}
    </Card>
  );

  const handleShare = async () => {
    const link = await shareMut.mutateAsync(tryout.name);
    await Share.share({
      message: `SquadOwl results for ${tryout.name}: https://tryouthq.app/?share=${link.token}\nExpires: ${new Date(link.expiresAt).toLocaleDateString()}`,
    });
  };

  return (
    <Screen scroll insideTabBar>
      <Header title="Export & Share" showBack />

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          {tryout.name}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {tryout.roster.length} players · {tryout.evals.length} evaluations
        </Text>
        <Button
          label="View Results Instantly"
          variant="secondary"
          onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentResults', params: { id } })}
        />
      </Card>

      {exportsAllowed ? (
        <View className="gap-3 mb-6">
          <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
            Export Formats
          </Text>
          {allowedFormats.includes('pdf') ? (
            <Card className="gap-3">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                PDF layout
              </Text>
              <View>
                <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                  Players per page
                </Text>
                <View className="flex-row flex-wrap">
                  {PLAYERS_PER_PAGE_OPTIONS.map((n) => (
                    <Chip
                      key={n}
                      label={n === 1 ? '1 (full detail)' : String(n)}
                      active={layout === 'cards' && playersPerPage === n && !(n === 1 && continuous)}
                      onPress={() => {
                        setLayout('cards');
                        setPlayersPerPage(n);
                        setContinuous(false);
                      }}
                    />
                  ))}
                  <Chip
                    label="Continuous (no gaps)"
                    active={layout === 'cards' && continuous}
                    onPress={() => {
                      setLayout('cards');
                      setPlayersPerPage(1);
                      setContinuous(true);
                    }}
                  />
                  <Chip
                    label="Compact list"
                    active={layout === 'list'}
                    onPress={() => {
                      setLayout('list');
                      setContinuous(false);
                    }}
                  />
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {layout === 'list'
                    ? 'A ranked list of names and scores only, with no comments, so a whole roster fits a page or two.'
                    : continuous
                    ? 'Players run one after another with no blank space, each with every evaluation listed.'
                    : playersPerPage === 1
                    ? 'One player per page, with every evaluation listed.'
                    : 'Several players per page: scores, ranks and notes. Individual evaluations are left out to keep each card small.'}
                </Text>
              </View>
              <View>
                <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                  Order players by
                </Text>
                <View className="flex-row flex-wrap">
                  {reportSortOptions(tryout).map((o) => (
                    <Chip key={o.key} label={o.label} active={sortBy === o.key} onPress={() => setSortBy(o.key)} />
                  ))}
                </View>
              </View>
              <View className="gap-3">
                <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Include players
                </Text>
                <Input
                  label="Top players only"
                  placeholder="All players"
                  keyboardType="number-pad"
                  value={topX}
                  onChangeText={(t) => setTopX(t.replace(/[^0-9]/g, ''))}
                />
                <Input
                  label="Overall score at least"
                  placeholder="Any score"
                  keyboardType="decimal-pad"
                  value={minScore}
                  onChangeText={(t) => setMinScore(t.replace(/[^0-9.]/g, ''))}
                />
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Scored players only (leave out incomplete)
                  </Text>
                  <Switch
                    value={scoredOnly}
                    onValueChange={setScoredOnly}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                {choices.positions.length > 0 ? (
                  <View>
                    <Text className="text-xs mb-1" style={{ color: colors.inkMuted }}>
                      Position
                    </Text>
                    <View className="flex-row flex-wrap">
                      {choices.positions.map((pos) => (
                        <Chip
                          key={pos}
                          label={pos}
                          active={positions.includes(pos)}
                          onPress={() => setPositions((l) => toggleIn(l, pos))}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                {choices.birthYears.length > 0 ? (
                  <View>
                    <Text className="text-xs mb-1" style={{ color: colors.inkMuted }}>
                      Age group (birth year)
                    </Text>
                    <View className="flex-row flex-wrap">
                      {choices.birthYears.map((y) => (
                        <Chip
                          key={y}
                          label={y}
                          active={birthYears.includes(y)}
                          onPress={() => setBirthYears((l) => toggleIn(l, y))}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
                <Text className="text-xs" style={{ color: filterActive && matchCount === 0 ? colors.danger : colors.inkMuted }}>
                  {filterActive
                    ? `${matchCount} of ${tryout.roster.length} players will be included.`
                    : 'Everyone is included. Pick any of the above to narrow it down.'}
                </Text>
              </View>
              <View>
                <Text className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: colors.inkMuted }}>
                  Show on the report
                </Text>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Individual rubric scores
                  </Text>
                  <Switch
                    value={content.rubricScores}
                    onValueChange={setContentFlag('rubricScores')}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Position / level
                  </Text>
                  <Switch
                    value={content.position}
                    onValueChange={setContentFlag('position')}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Overall ranking
                  </Text>
                  <Switch
                    value={content.ranking}
                    onValueChange={setContentFlag('ranking')}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Comments (recommendation, strengths, areas to improve)
                  </Text>
                  <Switch
                    value={content.comments}
                    onValueChange={setContentFlag('comments')}
                    disabled={layout === 'list'}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Assessor name
                  </Text>
                  <Switch
                    value={content.assessor}
                    onValueChange={setContentFlag('assessor')}
                    disabled={!singlePage}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View className="flex-row items-center justify-between py-1">
                  <Text className="text-sm flex-1 pr-3" style={{ color: colors.ink }}>
                    Date of evaluation
                  </Text>
                  <Switch
                    value={content.date}
                    onValueChange={setContentFlag('date')}
                    disabled={!singlePage}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                {!singlePage ? (
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Assessor and date appear with each evaluation, which only the one-player-per-page layout lists.
                  </Text>
                ) : null}
              </View>
              {(clubMode && organizationLogoUrl) || teamLogoUrl ? (
                <Pressable
                  onPress={() => setPrintLogo((v) => !v)}
                  className="flex-row items-center gap-2"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: printLogo }}
                >
                  <View
                    className="h-5 w-5 items-center justify-center rounded border"
                    style={{
                      borderColor: colors.primary,
                      backgroundColor: printLogo ? colors.primary : 'transparent',
                    }}
                  >
                    {printLogo ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                  </View>
                  <Text className="text-sm flex-1" style={{ color: colors.ink }}>
                    Print the team logo at the top of every page
                  </Text>
                </Pressable>
              ) : null}
              {(clubMode && organizationLogoUrl) || teamLogoUrl ? (
                <Pressable
                  onPress={() => setPrintAppLogo((v) => !v)}
                  className="flex-row items-center gap-2"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: printAppLogo }}
                >
                  <View
                    className="h-5 w-5 items-center justify-center rounded border"
                    style={{
                      borderColor: colors.primary,
                      backgroundColor: printAppLogo ? colors.primary : 'transparent',
                    }}
                  >
                    {printAppLogo ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                  </View>
                  <Text className="text-sm flex-1" style={{ color: colors.ink }}>
                    Also print the SquadOwl logo
                  </Text>
                </Pressable>
              ) : null}
              {rubricsCutOff ? (
                <Text className="text-xs font-bold" style={{ color: colors.danger }}>
                  Some players have {mostRubrics} rubrics, but this layout fits {cardCapacity} on a card, so the rest print
                  as "+N more". Choose 1 player per page, or Compact list, to print every rubric.
                </Text>
              ) : null}
              <Button label="Export PDF" variant="primary" onPress={() => handleExport('pdf')} loading={isExporting === 'pdf'} />
            </Card>
          ) : (
            lockedFormat('PDF Export', 'pdf', 'Coach+')
          )}
          {allowedFormats.includes('xlsx') ? (
            <Button label="Export XLSX" variant="secondary" onPress={() => handleExport('xlsx')} loading={isExporting === 'xlsx'} />
          ) : (
            lockedFormat('XLSX Export', 'xlsx', 'Club')
          )}
          <Button label="Export CSV" variant="secondary" onPress={() => handleExport('csv')} loading={isExporting === 'csv'} />
        </View>
      ) : (
        <PlanGate feature="exports" title="Exports" tierOverride={tier}>
          <View />
        </PlanGate>
      )}

      <PlanGate feature="shareLinks" title="Share Links" tierOverride={tier}>
        <Card accent className="gap-3">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Shareable Results Link
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Create a 7-day read-only link for team assignments or results.
          </Text>
          <Button label="Create Share Link" onPress={handleShare} loading={shareMut.isPending} />
        </Card>
      </PlanGate>
    </Screen>
  );
}
