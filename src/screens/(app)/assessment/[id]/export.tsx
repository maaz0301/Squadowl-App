import { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Header,
  LoadingState,
  Screen,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useExportTryoutMutation, useShareLinkMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import type { ExportFormat } from '@/data/types';
import { nextFrame } from '@/lib/nextFrame';

export default function ExportScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const exportMut = useExportTryoutMutation(id!);
  const shareMut = useShareLinkMutation(id!);
  const [isExporting, setIsExporting] = useState<string | null>(null);
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

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(format);
    try {
      await nextFrame();
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(tryout, format);
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
      <Button label="View Plans" onPress={() => navigation.navigate('Upgrade')} />
    </Card>
  );

  const handleShare = async () => {
    const link = await shareMut.mutateAsync(tryout.name);
    await Share.share({
      message: `TryoutHQ results for ${tryout.name}: https://tryouthq.app/?share=${link.token}\nExpires: ${new Date(link.expiresAt).toLocaleDateString()}`,
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
            <Button label="Export PDF" variant="secondary" onPress={() => handleExport('pdf')} loading={isExporting === 'pdf'} />
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
