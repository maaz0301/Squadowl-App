import { useState } from 'react';
import { Text, View, Alert, Pressable, Platform } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Chip, ErrorState, Header, Input, LoadingState, Screen, Badge } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { getPlanDefinition } from '@/data/plans';
import type { ScoringType, RankingDirection } from '@/data/types';

export default function RubricsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();

  const [role, setRole] = useState<'skater' | 'goalie' | 'all'>('skater');
  const [label, setLabel] = useState('');
  const [scoringType, setScoringType] = useState<ScoringType>('skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>('1-5');
  const [unit, setUnit] = useState('');
  const [minValStr, setMinValStr] = useState('');
  const [maxValStr, setMaxValStr] = useState('');

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  if (tryoutQuery.isLoading || !id) return <LoadingState message="Loading rubrics..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <ErrorState message="Could not load rubrics." onRetry={() => tryoutQuery.refetch()} />
    );
  }

  const tryout = tryoutQuery.data;
  const custom = tryout.settings.customRubrics ?? [];
  const plan = getPlanDefinition(user?.planTier ?? 'free');
  const customLimit = plan.limits.customRubrics;
  const atCustomLimit =
    customLimit !== 'unlimited' && custom.length >= (customLimit as number);

  const addCustom = async () => {
    if (!label.trim() || atCustomLimit) return;
    const key = label.trim().toLowerCase().replace(/\s+/g, '_');

    let rankingDirection: RankingDirection = 'higher_is_better';
    let defaultUnit = unit.trim();

    if (scoringType === 'time') {
      rankingDirection = 'lower_is_better';
      if (!defaultUnit) defaultUnit = 'sec';
    } else if (scoringType === 'distance') {
      rankingDirection = 'higher_is_better';
      if (!defaultUnit) defaultUnit = 'ft';
    } else if (scoringType === 'speed') {
      rankingDirection = 'higher_is_better';
      if (!defaultUnit) defaultUnit = 'mph';
    }

    const minNum = minValStr.trim() !== '' ? parseFloat(minValStr) : undefined;
    const maxNum = maxValStr.trim() !== '' ? parseFloat(maxValStr) : undefined;

    const nextItem = {
      key,
      label: label.trim(),
      scoringType,
      scale: scoringType === 'skill' ? scale : '1-5',
      unit: scoringType !== 'skill' ? defaultUnit : undefined,
      minVal: !isNaN(minNum as number) ? minNum : undefined,
      maxVal: !isNaN(maxNum as number) ? maxNum : undefined,
      rankingDirection,
      role,
    };

    const next = [...custom, nextItem];

    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        settings: {
          ...tryout.settings,
          customRubrics: next,
        },
      },
    });

    setLabel('');
    setUnit('');
    setMinValStr('');
    setMaxValStr('');
  };

  const removeCustom = async (keyToRemove: string) => {
    const next = custom.filter((r) => r.key !== keyToRemove);
    const nextSkaterWeights = { ...tryout.settings.skaterWeights };
    const nextGoalieWeights = { ...tryout.settings.goalieWeights };
    delete nextSkaterWeights[keyToRemove];
    delete nextGoalieWeights[keyToRemove];

    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          settings: {
            ...tryout.settings,
            customRubrics: next,
            skaterWeights: nextSkaterWeights,
            goalieWeights: nextGoalieWeights,
          },
        },
      });
      showAlert('Success', 'Custom rubric removed successfully.');
    } catch (err: any) {
      showAlert('Error', err.message || 'Failed to remove custom rubric.');
    }
  };

  return (
    <Screen scroll>
      <Header title="Assessment Rubrics" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Custom Rubric Builder
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          All rubrics are fully custom. Define drill categories, metric units, and min/max score benchmarks.
        </Text>
      </Card>

      <Card className="mb-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Created Rubrics ({custom.length}
            {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
          </Text>
        </View>

        {custom.map((r) => {
          const typeLabel = r.scoringType ?? 'skill';
          const ruleText = r.rankingDirection === 'lower_is_better' ? 'Shortest wins' : 'Highest wins';
          let details = r.scoringType === 'skill' || !r.scoringType
            ? `${r.scale ?? '1-5'} scale`
            : `${r.unit ?? ''} (${ruleText})`;

          if (r.minVal != null && r.maxVal != null) {
            details += ` · Range: ${r.minVal} to ${r.maxVal}`;
          }

          return (
            <View key={r.key} className="flex-row items-center justify-between py-2 border-b" style={{ borderColor: colors.border }}>
              <View className="flex-1 mr-2 gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="font-bold text-base" style={{ color: colors.ink }}>
                    {r.label}
                  </Text>
                  <Badge label={typeLabel.toUpperCase()} variant="brand" />
                  <Badge label={r.role ?? 'all'} variant="default" />
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {details}
                </Text>
              </View>

              <Pressable
                onPress={() => removeCustom(r.key)}
                hitSlop={8}
                className="px-2"
              >
                <Text style={{ color: colors.danger, fontSize: 22, fontWeight: 'bold' }}>
                  ✕
                </Text>
              </Pressable>
            </View>
          );
        })}

        {custom.length === 0 ? (
          <Text style={{ color: colors.inkMuted }}>
            No custom rubrics added yet. Use the builder below to add drills & categories.
          </Text>
        ) : null}
      </Card>

      <PlanGate feature="customRubrics" title="Custom Rubrics (Coach+)">
        <Card accent className="gap-3">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Add Custom Drill / Category
          </Text>

          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            1. Role
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip label="Skater" active={role === 'skater'} onPress={() => setRole('skater')} />
            <Chip label="Goalie" active={role === 'goalie'} onPress={() => setRole('goalie')} />
            <Chip label="All Players" active={role === 'all'} onPress={() => setRole('all')} />
          </View>

          <Input
            label="2. Drill / Category Name"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            3. Scoring Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Chip label="Skill / Technique" active={scoringType === 'skill'} onPress={() => setScoringType('skill')} />
            <Chip label="Time-based" active={scoringType === 'time'} onPress={() => setScoringType('time')} />
            <Chip label="Distance-based" active={scoringType === 'distance'} onPress={() => setScoringType('distance')} />
            <Chip label="Speed-based" active={scoringType === 'speed'} onPress={() => setScoringType('speed')} />
          </View>

          {scoringType === 'skill' ? (
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                4. Scale Choice
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip label="1-5 Scale" active={scale === '1-5'} onPress={() => setScale('1-5')} />
                <Chip label="1-10 Scale" active={scale === '1-10'} onPress={() => setScale('1-10')} />
              </View>
              <Text className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              <Input
                label="4. Unit Label (Optional)"
                value={unit}
                onChangeText={setUnit}
                placeholder={
                  scoringType === 'time'
                    ? 'sec (default)'
                    : scoringType === 'speed'
                    ? 'mph (default)'
                    : 'ft (default)'
                }
              />

              <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: colors.inkMuted }}>
                5. Score Range Benchmarks (Min & Max)
              </Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input
                    label="Min Value"
                    value={minValStr}
                    onChangeText={setMinValStr}
                    keyboardType="numeric"
                    placeholder={scoringType === 'time' ? '12 (Best)' : '5 (Worst)'}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Max Value"
                    value={maxValStr}
                    onChangeText={setMaxValStr}
                    keyboardType="numeric"
                    placeholder={scoringType === 'time' ? '25 (Worst)' : '25 (Best)'}
                  />
                </View>
              </View>

              <Text className="text-xs italic font-bold" style={{ color: colors.primary }}>
                Interpolation Rule:{' '}
                {scoringType === 'time'
                  ? `Min (${minValStr || '12'}) = Score 5.0  ·  Max (${maxValStr || '25'}) = Score 1.0 (Shortest time wins)`
                  : scoringType === 'distance'
                  ? `Min (${minValStr || '5'}) = Score 1.0  ·  Max (${maxValStr || '25'}) = Score 5.0 (Largest distance wins)`
                  : `Min (${minValStr || '10'}) = Score 1.0  ·  Max (${maxValStr || '60'}) = Score 5.0 (Fastest speed wins)`}
              </Text>
            </View>
          )}

          <Button
            label="Add Rubric Category"
            onPress={addCustom}
            loading={updateTryout.isPending}
            disabled={atCustomLimit || !label.trim()}
          />
        </Card>
      </PlanGate>
    </Screen>
  );
}
