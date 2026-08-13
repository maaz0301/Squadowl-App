import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Header,
  LoadingState,
  ErrorState,
  Screen,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useAiCompareMutation, computePlayerResults } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName } from '@/data/rubrics';

const LOADING_MESSAGES = [
  'Crunching the numbers…',
  'Weighing category scores…',
  'Comparing session trends…',
  'Drafting the scouting notes…',
];

export default function CompareScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const aiCompare = useAiCompareMutation(id!);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadingText, setLoadingText] = useState(LOADING_MESSAGES[0]);

  const selectedKey = [...selected].sort().join(',');
  const lastRunKeyRef = useRef<string | null>(null);

  // The mutation result stays around after selection changes — without this,
  // switching from comparing A+B to A+C would keep showing A+B's AI insights
  // under the new selection until "Run" is pressed again.
  useEffect(() => {
    if (lastRunKeyRef.current !== null && lastRunKeyRef.current !== selectedKey) {
      aiCompare.reset();
    }
  }, [selectedKey]);

  useEffect(() => {
    if (!aiCompare.isPending) return;
    let idx = 0;
    setLoadingText(LOADING_MESSAGES[0]);
    const int = setInterval(() => {
      idx = (idx + 1) % LOADING_MESSAGES.length;
      setLoadingText(LOADING_MESSAGES[idx]);
    }, 1800);
    return () => clearInterval(int);
  }, [aiCompare.isPending]);

  const results = useMemo(
    () => (tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : []),
    [tryoutQuery.data],
  );
  const resultByPlayerId = useMemo(() => new Map(results.map((r) => [r.player.id, r])), [results]);

  const selectedResults = useMemo(
    () => selected.map((pid) => resultByPlayerId.get(pid)).filter((r): r is NonNullable<typeof r> => !!r),
    [selected, resultByPlayerId],
  );

  const unscoredSelected = selectedResults.filter((r) => r.evalCount === 0);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Compare Players" showBack />
        <ErrorState message="Could not load compare data." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const tryout = tryoutQuery.data;
  const toggle = (playerId: string) => {
    setSelected((prev) =>
      prev.includes(playerId) ? prev.filter((p) => p !== playerId) : prev.length < 4 ? [...prev, playerId] : prev,
    );
  };

  const runCompare = () => {
    lastRunKeyRef.current = selectedKey;
    aiCompare.mutate(selected);
  };

  const errorMessage = (aiCompare.data as any)?.message || (aiCompare.error as any)?.message;
  const showError = aiCompare.isError || !!(aiCompare.data as any)?.error;
  const showResult = !showError && !!aiCompare.data;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header
          title="Compare Players"
          subtitle="Select 2–4 athletes"
          showBack
          onBack={() => navigation.navigate('AssessmentResults')}
        />
      </View>

      <FlatList
        data={tryout.roster}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ListHeaderComponent={
          selected.length >= 2 ? (
            <View className="gap-4 mb-4">
              <Card accent className="gap-2">
                <PlanGate feature="aiSummaries" title="AI Compare">
                  <View>
                    <Text className="font-bold mb-2" style={{ color: colors.primary }}>Deep AI Insights</Text>

                    {unscoredSelected.length > 0 ? (
                      <View
                        className="p-2 rounded-lg mb-2"
                        style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text className="text-xs" style={{ color: colors.inkMuted }}>
                          {unscoredSelected.map((r) => playerDisplayName(r.player)).join(', ')}{' '}
                          {unscoredSelected.length === 1 ? "hasn't" : "haven't"} been scored yet — the AI will call this out instead of guessing.
                        </Text>
                      </View>
                    ) : null}

                    <Button
                      label="Run Deep AI Compare"
                      onPress={runCompare}
                      loading={aiCompare.isPending}
                      size="sm"
                      className="mb-2"
                    />

                    {aiCompare.isPending ? (
                      <View className="items-center py-3">
                        <ActivityIndicator color={colors.primary} />
                        <Text className="mt-2 text-sm text-center" style={{ color: colors.inkMuted }}>
                          {loadingText}
                        </Text>
                      </View>
                    ) : showError ? (
                      <View
                        className="p-3 rounded-lg mt-1"
                        style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text className="font-bold text-md mb-1" style={{ color: colors.ink }}>⚠️ Cannot generate comparison</Text>
                        <Text className="text-md leading-6" style={{ color: colors.inkMuted }}>
                          {errorMessage || 'Make sure the selected players have been scored before running AI Compare.'}
                        </Text>
                      </View>
                    ) : showResult ? (
                      <View className="gap-3">
                        <Text className="text-md leading-6" style={{ color: colors.inkMuted }}>{aiCompare.data!.summary}</Text>
                        <Text className="text-md leading-6" style={{ color: colors.primary }}>{aiCompare.data!.edge}</Text>
                        <View
                          className="px-2 py-1 rounded-full border self-start"
                          style={{ backgroundColor: 'rgba(255,107,43,0.12)', borderColor: 'rgba(255,107,43,0.25)' }}
                        >
                          <Text className="text-md font-bold" style={{ color: colors.primary }}>
                            Best fit: {aiCompare.data!.best_fit}
                          </Text>
                        </View>

                        {aiCompare.data!.category_edges?.length ? (
                          <View className="gap-2">
                            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                              Category Leaders
                            </Text>
                            {aiCompare.data!.category_edges.map((ce, i) => (
                              <View key={`${ce.category}-${i}`} className="flex-row items-start gap-2">
                                <Badge label={ce.category} />
                                <View className="flex-1">
                                  <Text className="text-md font-bold" style={{ color: colors.ink }}>{ce.leader}</Text>
                                  <Text className="text-md leading-6" style={{ color: colors.inkMuted }}>{ce.note}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        {aiCompare.data!.player_notes?.length ? (
                          <View className="gap-2">
                            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                              Player Notes
                            </Text>
                            {aiCompare.data!.player_notes.map((pn, i) => (
                              <View
                                key={`${pn.name}-${i}`}
                                className="p-2 rounded-lg"
                                style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border }}
                              >
                                <Text className="text-md font-bold mb-1" style={{ color: colors.ink }}>{pn.name}</Text>
                                <Text className="text-md leading-6" style={{ color: colors.success }}>+ {pn.strength}</Text>
                                <Text className="text-md leading-6" style={{ color: colors.warning }}>△ {pn.growth}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}

                        <Text className="text-md leading-6" style={{ color: colors.ink }}>
                          Watch: {aiCompare.data!.watch_list.join(', ')}
                        </Text>
                        <Text className="text-md italic leading-6" style={{ color: colors.inkMuted }}>
                          {aiCompare.data!.recommendation}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </PlanGate>
              </Card>
            </View>
          ) : (
            <Text className="mb-4 italic" style={{ color: colors.inkMuted }}>
              Select at least 2 athletes below to compare.
            </Text>
          )
        }
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)}>
              <Card className={`mb-2 ${isSelected ? 'border-brand' : ''}`}>
                <View className="flex-row justify-between items-center">
                  <View className="flex-1 pr-4">
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {playerDisplayName(item)}
                    </Text>
                  </View>
                  {isSelected ? <Badge label="Selected" variant="brand" /> : null}
                </View>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
