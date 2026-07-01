import { useState } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateAssessmentFormSchema, SPORTS, EVENT_TYPES, type CreateAssessmentForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, DateField, TimeField, Input, Screen, Header, ErrorState, LoadingState } from '@/components/ui';
import { useCreateTryoutMutation, useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';

export default function NewAssessmentScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const createTryout = useCreateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const user = useUser();

  const { control, handleSubmit, watch, setValue } = useForm<CreateAssessmentForm>({
    resolver: zodResolver(CreateAssessmentFormSchema),
    defaultValues: {
      name: '',
      sport: 'Hockey',
      eventType: 'Tryout',
      tryoutDate: '',
      startTime: '',
      rink: '',
    },
  });

  const sport = watch('sport');
  const eventType = watch('eventType');
  const teamId = watch('teamId');

  const onSubmit = handleSubmit(async (data) => {
    const count = tryoutsQuery.data?.length ?? 0;
    if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
      navigation.navigate('/(app)/upgrade');
      return;
    }
    const tryout = await createTryout.mutateAsync(data);
    setCurrentTryout(tryout.id);
    navigation.replace(`/(app)/assessment/${tryout.id}/settings?welcome=1`);
  });

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Assessment" showBack />
        <ErrorState
          message="Could not load required data."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="New Assessment" showBack />
      <View className="gap-4 mt-2">
        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
            <Input label="Assessment Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} placeholder="Spring U14 Tryout" />
          )}
        />

        <View>
          <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
            Sport
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {SPORTS.map((s) => (
              <Chip key={s} label={s} active={sport === s} onPress={() => setValue('sport', s)} />
            ))}
          </ScrollView>
        </View>

        <View>
          <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
            Event Type
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {EVENT_TYPES.map((t) => (
              <Chip key={t} label={t} active={eventType === t} onPress={() => setValue('eventType', t)} />
            ))}
          </ScrollView>
        </View>

        {teamsQuery.data && teamsQuery.data.length > 0 ? (
          <View>
            <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
              Team (optional)
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {teamsQuery.data.map((team) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  active={teamId === team.id}
                  onPress={() =>
                    setValue('teamId', teamId === team.id ? undefined : team.id)
                  }
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Controller
          control={control}
          name="tryoutDate"
          render={({ field: { onChange, value } }) => (
            <DateField label="Date" value={value} onChange={onChange} placeholder="Select a date" />
          )}
        />
        <Controller
          control={control}
          name="startTime"
          render={({ field: { onChange, value } }) => (
            <TimeField label="Start Time" value={value} onChange={onChange} placeholder="Select a time" />
          )}
        />
        <Controller
          control={control}
          name="rink"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Location / Rink" placeholder="Rink A" onBlur={onBlur} onChangeText={onChange} value={value} />
          )}
        />

        <Button label="Create Assessment" onPress={onSubmit} loading={createTryout.isPending} className="mt-2" />
      </View>
    </Screen>
  );
}
