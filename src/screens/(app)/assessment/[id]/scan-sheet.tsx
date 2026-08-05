import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useImportScanScoresMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerSubskills, playerDisplayName } from '@/data/rubrics';

export default function ScanSheetScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const importScores = useImportScanScoresMutation();
  const [imported, setImported] = useState(false);

  const preview = useMemo(() => {
    if (!tryoutQuery.data) return [];
    return tryoutQuery.data.roster.slice(0, 5).map((p) => {
      const subskills = getPlayerSubskills(tryoutQuery.data!.sport, p.pos, tryoutQuery.data!.settings.customRubrics);
      const scores = subskills.slice(0, 3).map((r) => ({
        rubricKey: r.key,
        value: 3 + Math.floor(Math.random() * 2),
      }));
      return { player: p, scores };
    });
  }, [tryoutQuery.data]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading scan sheet..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Scan Sheet" showBack onBack={() => navigation.navigate('AssessmentRoster')} />
        <ErrorState message="Could not load scan sheet." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const tryout = tryoutQuery.data;

  const simulateImport = async () => {
    const scores = preview.flatMap((item: any) =>
      item.scores.map((sc: any) => ({ playerId: item.player.id, rubricKey: sc.rubricKey, value: sc.value })),
    );
    await importScores.mutateAsync({ tryoutId: id!, scores });
    setImported(true);
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Scan Sheet Import" showBack onBack={() => navigation.navigate('AssessmentRoster')} />
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
                <Button label="View Results" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentResults', params: { id: id } })} />
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
