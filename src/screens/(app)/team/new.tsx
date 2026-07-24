import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Button, Card, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { canUseFeature, isAtTeamLimit } from '@/data/plans';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
import {
  useClearDummyTeamsMutation,
  useCreateTeamMutation,
  useGenerateDummyTeamsMutation,
  useTeamsQuery,
} from '@/features/queries';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

const FormSchema = z.object({
  name: z.string().min(2, 'Team name required'),
  season: z.string().optional(),
});

type Form = z.infer<typeof FormSchema>;

export default function NewTeamScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const createTeam = useCreateTeamMutation();
  const teamsQuery = useTeamsQuery();
  const genDummy = useGenerateDummyTeamsMutation();
  const clearDummy = useClearDummyTeamsMutation();
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [showDummy, setShowDummy] = useState(false);

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', season: '2025-26' },
  });

  const onSubmit = handleSubmit(async (data) => {
    const count = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg('You have reached the maximum number of teams for your current plan.');
      return;
    }
    await createTeam.mutateAsync({ name: data.name, season: data.season });
    navigation.goBack();
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1)) {
      setShowDummy(false);
      setLimitMsg('You have reached the maximum number of teams for your current plan.');
      return;
    }
    try {
      const res = await genDummy.mutateAsync(options);
      setShowDummy(false);
      showAlert(
        'Dummy teams created',
        `Created ${res.teams} team${res.teams === 1 ? '' : 's'} with ${res.assessments} linked ` +
        `assessment${res.assessments === 1 ? '' : 's'}, ${res.players} players, and ` +
        `${res.evaluations} evaluations.`,
      );
      navigation.goBack();
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to generate dummy teams.');
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearDummy.mutateAsync();
      showAlert(
        'Cleared',
        res.assessments === 0
          ? 'No dummy teams to remove.'
          : `Removed ${res.teams} team${res.teams === 1 ? '' : 's'} and ${res.assessments} ` +
          `assessment${res.assessments === 1 ? '' : 's'}.`,
      );
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to clear dummy teams.');
    }
  };

  if (teamsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Team" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="New Team" showBack />
      <View className="gap-4 mt-2">
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
            <Input label="Team Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
          )}
        />
        <Controller
          control={control}
          name="season"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Season (optional)" onBlur={onBlur} onChangeText={onChange} value={value ?? ''} />
          )}
        />
        <Button label="Create Team" onPress={onSubmit} loading={createTeam.isPending} />
      </View>

      {isAssociation ? (
        <Card className="mt-6 gap-2">
          <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Testing Tools
          </Text>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Skip the form and generate whole teams — each with a linked assessment, a rubric set,
            and a roster of dummy players you can optionally score.
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-1">
            <Button label="Dummy Data" size="sm" onPress={() => setShowDummy(true)} />
            <Button
              label="Clear Dummy Teams"
              size="sm"
              variant="ghost"
              loading={clearDummy.isPending}
              onPress={runClearDummy}
            />
          </View>
        </Card>
      ) : null}

      <DummyDataModal
        variant="team"
        visible={showDummy}
        loading={genDummy.isPending}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
