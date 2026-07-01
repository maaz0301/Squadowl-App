import { useState } from 'react';
import { Share, Text, View, Platform } from 'react-native';
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
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  const exportMut = useExportTryoutMutation(id!);
  const shareMut = useShareLinkMutation(id!);
  const [lastExport, setLastExport] = useState<string | null>(null);

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const tier = user?.planTier ?? 'free';
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';

  const handleExport = async (format: ExportFormat) => {
    const result = await exportMut.mutateAsync(format);
    setLastExport(result.filename);
    
    if (format === 'csv') {
      if (Platform.OS === 'web') {
        const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', result.filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const path = `${RNFS.CachesDirectoryPath}/${result.filename}`;
        await RNFS.writeFile(path, result.content, 'utf8');
        try {
          await RNShare.open({
            url: `file://${path}`,
            type: 'text/csv',
            filename: result.filename,
            title: `Export ${result.filename}`
          });
        } catch (e: any) {
          if (e.message !== 'User did not share') {
            await Share.share({ message: result.content, title: result.filename });
          }
        }
      }
    } else {
      await Share.share({ message: result.content, title: result.filename });
    }
  };

  const handleShare = async () => {
    const link = await shareMut.mutateAsync(tryout.name);
    await Share.share({
      message: `Team results for ${tryout.name}: https://aas-tryout.app/?share=${link.token}\nExpires: ${new Date(link.expiresAt).toLocaleDateString()}`,
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
          <Button label="Export CSV" variant="secondary" onPress={() => handleExport('csv')} loading={exportMut.isPending} />
          <PlanGate feature="exports">
            <Button label="Export PDF" variant="secondary" onPress={() => handleExport('pdf')} />
            <Button label="Export XLSX" variant="secondary" onPress={() => handleExport('xlsx')} className="mt-2" />
          </PlanGate>
          {lastExport ? <Badge label={`Exported: ${lastExport}`} variant="success" /> : null}
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
