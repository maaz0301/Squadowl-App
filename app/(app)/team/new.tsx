import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useCreateTeamMutation, useTeamsQuery } from '@/features/queries';
import { useUser } from '@/state/authStore';
import { isAtTeamLimit } from '@/data/plans';

const FormSchema = z.object({
  name: z.string().min(2, 'Team name required'),
  season: z.string().optional(),
});

type Form = z.infer<typeof FormSchema>;

export default function NewTeamScreen() {
  const router = useRouter();
  const createTeam = useCreateTeamMutation();
  const teamsQuery = useTeamsQuery();
  const user = useUser();
  const [limitHit, setLimitHit] = useState(false);

  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', season: '2025-26' },
  });

  const onSubmit = handleSubmit(async (data) => {
    const count = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', count)) {
      setLimitHit(true);
      return;
    }
    await createTeam.mutateAsync({ name: data.name, season: data.season });
    router.back();
  });

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
        {limitHit ? (
          <Button label="Team limit reached — View Plans" variant="secondary" onPress={() => router.push('/(app)/upgrade')} />
        ) : null}
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
    </Screen>
  );
}
