import { useState } from 'react';
import { Text, View, Alert, Pressable, Platform } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Chip, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
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
    try {
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
      showAlert('Success', `${forRole.charAt(0).toUpperCase() + forRole.slice(1)} weights successfully reset to default values.`);
    } catch (err: any) {
      showAlert('Error', err.message || 'Failed to reset weights.');
    }
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
        {/* <Button label="Reset Skater Weights" size="sm" variant="ghost" onPress={() => resetWeights('skater')} /> */}
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
          {/* <Button label="Reset Goalie Weights" size="sm" variant="ghost" onPress={() => resetWeights('goalie')} /> */}
        </Card>
      ) : null}

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Custom Rubrics ({custom.length}
          {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
        </Text>
        {custom.map((r) => (
          <View key={r.key} className="flex-row items-center justify-between py-1">
            <Text style={{ color: colors.ink }} className="flex-1 mr-2">
              {r.label} · {r.scale} · {r.role ?? 'all'}
            </Text>
            <Pressable 
              onPress={() => removeCustom(r.key)}
              hitSlop={8}
              className="px-2"
            >
              <Text style={{ color: colors.danger, fontSize: 24, fontWeight: 'bold' }}>
                -
              </Text>
            </Pressable>
          </View>
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
