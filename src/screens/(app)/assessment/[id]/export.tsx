import { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
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
import { PLAYERS_PER_PAGE_OPTIONS, reportLogoUrls, type PlayersPerPage } from '@/lib/reportPdf';
import { REPORT_SORT_OPTIONS, type ReportSort } from '@/data/resultsExport';
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
  // The team's own logo, for club accounts. A hook, so it runs before the
  // loading/error guards below.
  const teamsQuery = useTeamsQuery();
  const teamLogoUrl = teamsQuery.data?.find((t) => t.id === tryoutQuery.data?.teamId)?.logoUrl;
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

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(format);
    try {
      await nextFrame();
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(
        tryout,
        format,
        format === 'pdf'
          ? { playersPerPage, continuous: continuous && playersPerPage === 1, logoUrls: reportLogoUrls({ club: clubMode && printLogo, organizationLogoUrl, teamLogoUrl }), sortBy }
          : undefined,
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
          <Button label="Export CSV" variant="secondary" onPress={() => handleExport('csv')} loading={isExporting === 'csv'} />
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
                      active={playersPerPage === n && !(n === 1 && continuous)}
                      onPress={() => {
                        setPlayersPerPage(n);
                        setContinuous(false);
                      }}
                    />
                  ))}
                  <Chip
                    label="Continuous (no gaps)"
                    active={continuous}
                    onPress={() => {
                      setPlayersPerPage(1);
                      setContinuous(true);
                    }}
                  />
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {continuous
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
                  {REPORT_SORT_OPTIONS.map((o) => (
                    <Chip key={o.key} label={o.label} active={sortBy === o.key} onPress={() => setSortBy(o.key)} />
                  ))}
                </View>
              </View>
              {clubMode && (organizationLogoUrl || teamLogoUrl) ? (
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
                    Print the organization and team logos at the top of every page
                  </Text>
                </Pressable>
              ) : null}
              <Button label="Export PDF" variant="secondary" onPress={() => handleExport('pdf')} loading={isExporting === 'pdf'} />
            </Card>
          ) : (
            lockedFormat('PDF Export', 'pdf', 'Coach+')
          )}
          {allowedFormats.includes('xlsx') ? (
            <Button label="Export XLSX" variant="secondary" onPress={() => handleExport('xlsx')} loading={isExporting === 'xlsx'} />
          ) : (
            lockedFormat('XLSX Export', 'xlsx', 'Club')
          )}
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
