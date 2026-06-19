import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Chip, Input, Modal, Screen } from '@/components/ui';
import { useSeasonQuery, useAddSeasonEventMutation, useDeleteSeasonEventMutation } from '@/features/queries';

export default function SeasonScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const addEvent = useAddSeasonEventMutation(id!);
  const deleteEvent = useDeleteSeasonEventMutation(id!);
  const [showAdd, setShowAdd] = useState(false);

  const { control, handleSubmit, watch, setValue, reset } = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '' },
  });

  if (seasonQuery.isLoading) return null;
  const season = seasonQuery.data!;
  const eventType = watch('type');

  const onSubmit = handleSubmit(async (data) => {
    await addEvent.mutateAsync(data);
    reset();
    setShowAdd(false);
  });

  return (
    <Screen padded={false}>
      <View className="px-4 py-3">
        <Button label="+ Add Event" onPress={() => setShowAdd(true)} />
      </View>
      <FlatList
        data={[...season.events].sort((a, b) => a.date.localeCompare(b.date))}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Card className="mb-2 gap-1">
            <View className="flex-row justify-between">
              <Text className="font-bold" style={{ color: colors.ink }}>{item.title}</Text>
              <Badge label={item.type} variant={item.type === 'Game' ? 'brand' : 'default'} />
            </View>
            <Text style={{ color: colors.inkMuted }}>
              {item.date} · {item.startTime ?? '—'}–{item.endTime ?? '—'}
            </Text>
            {item.location ? <Text style={{ color: colors.inkFaint }}>{item.location}</Text> : null}
            <Button label="Delete" variant="ghost" size="sm" onPress={() => deleteEvent.mutate(item.id)} />
          </Card>
        )}
      />

      <Modal visible={showAdd} title="Add Event" onClose={() => setShowAdd(false)}>
        <View className="gap-3">
          <View className="flex-row flex-wrap">
            {EVENT_KINDS.map((t) => (
              <Chip key={t} label={t} active={eventType === t} onPress={() => setValue('type', t)} />
            ))}
          </View>
          <Controller control={control} name="title" render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
            <Input label="Title" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
          )} />
          <Controller control={control} name="date" render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
            <Input label="Date" placeholder="2026-03-20" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
          )} />
          <Controller control={control} name="startTime" render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Start Time" placeholder="18:00" onBlur={onBlur} onChangeText={onChange} value={value} />
          )} />
          <Controller control={control} name="location" render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Location" onBlur={onBlur} onChangeText={onChange} value={value} />
          )} />
          <Button label="Save Event" onPress={onSubmit} loading={addEvent.isPending} />
        </View>
      </Modal>
    </Screen>
  );
}
