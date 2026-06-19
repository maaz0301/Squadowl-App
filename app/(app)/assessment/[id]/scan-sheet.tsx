import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, LoadingState, Screen } from '@/components/ui';
import { useImportScanScoresMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerRubrics, playerDisplayName } from '@/data/rubrics';

export default function ScanSheetScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutQuery = useTryoutQuery(id);
  const importScores = useImportScanScoresMutation();
  const [imported, setImported] = useState(false);

  const preview = useMemo(() => {
    if (!tryoutQuery.data) return [];
    return tryoutQuery.data.roster.slice(0, 5).map((p) => {
      const rubrics = getPlayerRubrics(tryoutQuery.data!.sport, p.pos, tryoutQuery.data!.settings.customRubrics);
      const scores = rubrics.slice(0, 3).map((r) => ({
        rubricKey: r.key,
        value: 3 + Math.floor(Math.random() * 2),
      }));
      return { player: p, scores };
    });
  }, [tryoutQuery.data]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading scan sheet..." />;

  const tryout = tryoutQuery.data!;

  const simulateImport = async () => {
    const scores = preview.flatMap(({ player, scores: s }) =>
      s.map((sc) => ({ playerId: player.id, rubricKey: sc.rubricKey, value: sc.value })),
    );
    await importScores.mutateAsync({ tryoutId: id!, scores });
    setImported(true);
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Scan Sheet Import" showBack />
        <Card accent className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Paper score sheet → digital
          </Text>
          <Text style={{ color: colors.inkMuted }}>
            Camera OCR is not wired yet. This demo simulates importing scanned scores for the first
            5 players.
          </Text>
          <Badge label={`${tryout.roster.length} players on roster`} />
        </Card>
      </View>

      <FlatList
        data={preview}
        keyExtractor={(item) => item.player.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <Card className="mb-2 gap-1">
            <Text className="font-bold" style={{ color: colors.ink }}>
              {playerDisplayName(item.player)}
            </Text>
            {item.scores.map((s) => (
              <Text key={s.rubricKey} className="text-sm" style={{ color: colors.inkMuted }}>
                {s.rubricKey}: {s.value}
              </Text>
            ))}
          </Card>
        )}
        ListFooterComponent={
          <View className="gap-2 mt-4">
            {imported ? (
              <Card accent className="items-center py-4">
                <Text className="font-display font-bold" style={{ color: colors.success }}>
                  Scores imported successfully
                </Text>
                <Button label="View Results" onPress={() => router.push(`/(app)/assessment/${id}/results`)} />
              </Card>
            ) : (
              <Button label="Simulate Scan Import" loading={importScores.isPending} onPress={simulateImport} />
            )}
          </View>
        }
      />
    </Screen>
  );
}
