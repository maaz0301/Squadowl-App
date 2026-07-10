import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';

import { ScrollView, Text, View } from 'react-native';
import { CreateSeasonFormSchema, SPORTS, type CreateSeasonForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, Input, Header, ErrorState, LoadingState, Screen } from '@/components/ui';
import { useCreateSeasonMutation, useTeamsQuery } from '@/features/queries';
import { PlanGate } from '@/components/PlanGate';

export default function NewSeasonScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const createSeason = useCreateSeasonMutation();
  const teamsQuery = useTeamsQuery();

  const { control, handleSubmit, watch, setValue, reset } = useForm<CreateSeasonForm>({
    resolver: zodResolver(CreateSeasonFormSchema),
    defaultValues: { name: '', teamName: '', sport: 'Hockey', year: '2025-26' },
  });

  useFocusEffect(
    useCallback(() => {
      reset({ name: '', teamName: '', sport: 'Hockey', year: '2025-26' });
    }, [reset])
  );

  const sport = watch('sport');

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
      <PlanGate feature="seasonHub" title="Season Hub (Coach+)">
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
          {teamsQuery.data?.length ? (
            <View>
              <Text className="text-xs font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>Link Team</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {teamsQuery.data.map((t) => (
                  <Chip key={t.id} label={t.name} onPress={() => { setValue('teamId', t.id); setValue('teamName', t.name); }} />
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
