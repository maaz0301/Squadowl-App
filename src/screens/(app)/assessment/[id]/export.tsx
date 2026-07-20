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
import { canUseFeature } from '@/data/plans';
import { useUser } from '@/state/authStore';
import type { ExportFormat } from '@/data/types';

export default function ExportScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  const exportMut = useExportTryoutMutation(id!);
  const shareMut = useShareLinkMutation(id!);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const tier = user?.planTier ?? 'free';
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(format);
    try {
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(tryout, format);
    } catch (e: any) {
      console.error(e);
      // Optional: show error alert
    } finally {
      setIsExporting(null);
    }
  };

  const handleShare = async () => {
    const link = await shareMut.mutateAsync(tryout.name);
    await Share.share({
      message: `TryoutHQ results for ${tryout.name}: https://tryouthq.app/?share=${link.token}\nExpires: ${new Date(link.expiresAt).toLocaleDateString()}`,
    });
  };

  return (
    <Screen scroll>
      <Header title="Export & Share" showBack />

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          {tryout.name}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {tryout.roster.length} players · {tryout.evals.length} evaluations
        </Text>
      </Card>

      {exportsAllowed ? (
        <View className="gap-3 mb-6">
          <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
            Export Formats
          </Text>
          <Button label="Export CSV" variant="secondary" onPress={() => handleExport('csv')} loading={isExporting === 'csv'} />
          <PlanGate feature="exports">
            <Button label="Export PDF" variant="secondary" onPress={() => handleExport('pdf')} loading={isExporting === 'pdf'} />
            <Button label="Export XLSX" variant="secondary" onPress={() => handleExport('xlsx')} className="mt-2" loading={isExporting === 'xlsx'} />
          </PlanGate>
        </View>
      ) : (
        <PlanGate feature="exports" title="Exports require Coach plan+">
          <View />
        </PlanGate>
      )}

      <PlanGate feature="shareLinks" title="Share Links (Club+)">
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
