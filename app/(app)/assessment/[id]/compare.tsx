import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
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
import { useTryoutQuery, useAiCompareMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName } from '@/data/rubrics';

export default function CompareScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const aiCompare = useAiCompareMutation(id!);
  const [selected, setSelected] = useState<string[]>([]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll>
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

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Compare Players" subtitle="Select 2–4 athletes" showBack />
        <PlanGate feature="aiSummaries" title="AI Compare (Club+)">
          <Button
            label={`Run AI Compare (${selected.length} selected)`}
            onPress={() => aiCompare.mutate(selected)}
            loading={aiCompare.isPending}
            disabled={selected.length < 2}
            className="mb-4"
          />
          {aiCompare.data ? (
            <Card accent className="mb-4 gap-2">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                AI Analysis
              </Text>
              <Text style={{ color: colors.inkMuted }}>{aiCompare.data.summary}</Text>
              <Text style={{ color: colors.primary }}>{aiCompare.data.edge}</Text>
              <Badge label={`Best fit: ${aiCompare.data.best_fit}`} variant="brand" />
              <Text className="text-sm" style={{ color: colors.ink }}>
                Watch: {aiCompare.data.watch_list.join(', ')}
              </Text>
              <Text className="text-sm italic" style={{ color: colors.inkMuted }}>
                {aiCompare.data.recommendation}
              </Text>
            </Card>
          ) : null}
        </PlanGate>
      </View>

      <FlatList
        data={tryout.roster}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item }) => {
          const isSelected = selected.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)}>
              <Card className={`mb-2 ${isSelected ? 'border-brand' : ''}`}>
                <View className="flex-row justify-between items-center">
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(item)}
                  </Text>
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
