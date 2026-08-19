import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useCallback } from 'react';

import { ScrollView, Text, View } from 'react-native';
import { CreateSeasonFormSchema, SPORTS, type CreateSeasonForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, Input, Header, ErrorState, LoadingState, Screen } from '@/components/ui';
import { useCreateSeasonMutation, useTeamsQuery } from '@/features/queries';
import { PlanGate } from '@/components/PlanGate';
import { useUser } from '@/state/authStore';
import { effectiveTierForTeam } from '@/data/plans';

export default function NewSeasonScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const createSeason = useCreateSeasonMutation();
  const teamsQuery = useTeamsQuery();

  // Arriving from a team's Events section pre-links that team so the coach
  // doesn't have to re-pick it.
  const presetTeamId: string | undefined = route.params?.teamId;
  const presetTeamName: string = route.params?.teamName ?? '';

  const { control, handleSubmit, watch, setValue, reset } = useForm<CreateSeasonForm>({
    resolver: zodResolver(CreateSeasonFormSchema),
    defaultValues: { name: '', teamName: presetTeamName, sport: 'Hockey', year: '2025-26', teamId: presetTeamId },
  });

  useFocusEffect(
    useCallback(() => {
      reset({ name: '', teamName: presetTeamName, sport: 'Hockey', year: '2025-26', teamId: presetTeamId });
    }, [reset, presetTeamId, presetTeamName])
  );

  const sport = watch('sport');
  const selectedTeamId = watch('teamId');
  const user = useUser();
  // A season created for (or linked to) a delegated team gates against the
  // owning club's tier, not the viewer's own.
  const selectedTeam = selectedTeamId ? teamsQuery.data?.find((t) => t.id === selectedTeamId) : undefined;
  const tier = effectiveTierForTeam(selectedTeam, user?.planTier ?? 'free');

  const onSubmit = handleSubmit(async (data) => {
    const season = await createSeason.mutateAsync(data);
    navigation.replace('SeasonDetail', { id: season.id });
  });

  if (teamsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Season" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="New Season" subtitle="Team Hub setup" showBack />
      <PlanGate feature="seasonHub" title="Season Hub" tierOverride={tier}>
        <View className="gap-4 mt-2">
          <Controller
            control={control}
            name="name"
            render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
              <Input label="Season Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} placeholder="2025-26 U14 Season" />
            )}
          />
          <Controller
            control={control}
            name="teamName"
            render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
              <Input label="Team Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
            )}
          />
          <View>
            <Text className="text-xs font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>Sport</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {SPORTS.map((s) => (
                <Chip key={s} label={s} active={sport === s} onPress={() => setValue('sport', s)} />
              ))}
            </ScrollView>
          </View>
          <Controller
            control={control}
            name="year"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Year" onBlur={onBlur} onChangeText={onChange} value={value} />
            )}
          />
          <Controller
            control={control}
            name="division"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input label="Division" onBlur={onBlur} onChangeText={onChange} value={value} placeholder="U14 AA" />
            )}
          />
          {presetTeamId ? (
            // Created from inside a team's Events section — the linked team is
            // that team, so it's shown as a fact rather than a choice.
            <View>
              <Text className="text-xs font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>Linked Team</Text>
              <Chip label={presetTeamName} active />
            </View>
          ) : teamsQuery.data?.length ? (
            <View>
              <Text className="text-xs font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>Link Team</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {teamsQuery.data.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    active={watch('teamId') === t.id}
                    onPress={() => { setValue('teamId', t.id); setValue('teamName', t.name); }}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}
          <Button label="Create Season" onPress={onSubmit} loading={createSeason.isPending} />
        </View>
      </PlanGate>
    </Screen>
  );
}
