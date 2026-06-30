import { useState } from 'react';
import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Chip, ErrorState, Input, LoadingState, Screen } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getDefaultRubrics, buildDefaultWeights } from '@/data/rubrics';
import { useUser } from '@/state/authStore';
import { getPlanDefinition } from '@/data/plans';

export default function RubricsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();
  const [role, setRole] = useState<'skater' | 'goalie'>('skater');
  const [label, setLabel] = useState('');
  const [scale, setScale] = useState<'1-5' | '1-10'>('1-5');

  if (tryoutQuery.isLoading || !id) return <LoadingState message="Loading rubrics..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <ErrorState message="Could not load rubrics." onRetry={() => tryoutQuery.refetch()} />
    );
  }

  const tryout = tryoutQuery.data;

  const defaults = getDefaultRubrics(tryout.sport);
  const custom = tryout.settings.customRubrics ?? [];
  const plan = getPlanDefinition(user?.planTier ?? 'free');
  const customLimit = plan.limits.customRubrics;
  const atCustomLimit =
    customLimit !== 'unlimited' && custom.length >= (customLimit as number);

  const addCustom = async () => {
    if (!label.trim() || atCustomLimit) return;
    const key = label.trim().toLowerCase().replace(/\s+/g, '_');
    const next = [
      ...custom,
      { key, label: label.trim(), scale, role: (role === 'goalie' ? 'goalie' : 'skater') as 'skater' | 'goalie' },
    ];
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        settings: {
          ...tryout.settings,
          customRubrics: next,
          skaterWeights: tryout.settings.skaterWeights,
          goalieWeights: tryout.settings.goalieWeights,
        },
      },
    });
    setLabel('');
  };

  const resetWeights = async (forRole: 'skater' | 'goalie') => {
    const baseCats = forRole === 'goalie' ? defaults.goalie : defaults.skater;
    const customCats = custom
      .filter((r) => r.role === forRole || r.role === 'all' || !r.role)
      .map((r) => ({
        key: r.key,
        label: r.label,
        role: forRole,
        subskills: [
          { key: r.key, label: r.label, scale: (r.scale === '1-10' ? '1-10' : '1-5') as '1-5' | '1-10' },
        ],
      }));
    const weights = buildDefaultWeights([...baseCats, ...customCats]);
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        settings: {
          ...tryout.settings,
          [forRole === 'goalie' ? 'goalieWeights' : 'skaterWeights']: weights,
        },
      },
    });
  };

  return (
    <Screen scroll>
      <Card accent className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Rubric Builder
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          Default {defaults.skater.length} skater + {defaults.goalie.length} goalie categories for{' '}
          {tryout.sport}.
        </Text>
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Default Skater Rubrics
        </Text>
        {defaults.skater.map((r) => (
          <Text key={r.key} style={{ color: colors.ink }}>
            {r.label} · {r.subskills.length} skills
          </Text>
        ))}
        <Button label="Reset Skater Weights" size="sm" variant="ghost" onPress={() => resetWeights('skater')} />
      </Card>

      {defaults.goalie.length > 0 ? (
        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Default Goalie Rubrics
          </Text>
          {defaults.goalie.map((r) => (
            <Text key={r.key} style={{ color: colors.ink }}>
              {r.label} · {r.subskills.length} skills
            </Text>
          ))}
          <Button label="Reset Goalie Weights" size="sm" variant="ghost" onPress={() => resetWeights('goalie')} />
        </Card>
      ) : null}

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Custom Rubrics ({custom.length}
          {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
        </Text>
        {custom.map((r) => (
          <Text key={r.key} style={{ color: colors.ink }}>
            {r.label} · {r.scale} · {r.role ?? 'all'}
          </Text>
        ))}
        {custom.length === 0 ? (
          <Text style={{ color: colors.inkMuted }}>No custom rubrics yet.</Text>
        ) : null}
      </Card>

      <PlanGate feature="customRubrics" title="Custom Rubrics (Coach+)">
        <Card accent className="gap-3">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Add Custom Category
          </Text>
          <View className="flex-row flex-wrap">
            <Chip label="Skater" active={role === 'skater'} onPress={() => setRole('skater')} />
            <Chip label="Goalie" active={role === 'goalie'} onPress={() => setRole('goalie')} />
          </View>
          <Input label="Category name" value={label} onChangeText={setLabel} placeholder="Leadership" />
          <View className="flex-row flex-wrap">
            <Chip label="1-5" active={scale === '1-5'} onPress={() => setScale('1-5')} />
            <Chip label="1-10" active={scale === '1-10'} onPress={() => setScale('1-10')} />
          </View>
          <Button
            label="Add Rubric"
            onPress={addCustom}
            loading={updateTryout.isPending}
            disabled={atCustomLimit}
          />
        </Card>
      </PlanGate>
    </Screen>
  );
}
