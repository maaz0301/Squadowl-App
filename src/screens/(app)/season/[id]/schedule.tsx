import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Modal, Screen, DateField, TimeField, Header } from '@/components/ui';
import { useSeasonQuery, useAddSeasonEventMutation, useDeleteSeasonEventMutation } from '@/features/queries';
import { getDataSource } from '@/data';
import { Alert, Platform } from 'react-native';

export default function SeasonScheduleScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const addEvent = useAddSeasonEventMutation(id!);
  const deleteEvent = useDeleteSeasonEventMutation(id!);
  const [showAdd, setShowAdd] = useState(false);
  const [reminding, setReminding] = useState<string | null>(null);

  const { control, handleSubmit, watch, setValue, reset, setError } = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '' },
  });

  if (seasonQuery.isLoading) return <LoadingState message="Loading schedule..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load schedule." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;
  const eventType = watch('type');

  const onSubmit = handleSubmit(
    async (data) => {
      // Validate that event is between today (current time onwards) and up to two days from now
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      const eventDate = new Date(y, m - 1, d, hour, min);
      
      const now = new Date();

      if (eventDate < now) {
        setError('date', {
          type: 'manual',
          message: 'Event must be scheduled from today onwards.',
        });
        const errorMsg = 'Event must be scheduled from today onwards.';
        if (Platform.OS === 'web') {
          alert(`Validation Error\n\n${errorMsg}`);
        } else {
          Alert.alert('Validation Error', errorMsg);
        }
        return;
      }

      await addEvent.mutateAsync(data);
      reset();
      setShowAdd(false);
    },
    (errors) => {
      const msg = errors.date?.message || errors.title?.message || 'Please check the required fields and date format.';
      if (Platform.OS === 'web') {
        alert(`Validation Error\n\n${msg}`);
      } else {
        Alert.alert('Validation Error', msg);
      }
    }
  );

  const sendReminder = async (event: import('@/data/types').SeasonEvent) => {
    try {
      setReminding(event.id);
      const emails = Array.from(new Set(
        season.roster
          .map(p => p.guardianEmail)
          .filter(Boolean)
      ));
      
      if (emails.length === 0) {
        if (Platform.OS === 'web') alert('No Emails: There are no guardians with emails in the roster.');
        else Alert.alert('No Emails', 'There are no guardians with emails in the roster.');
        return;
      }
      
      let sent = 0;
      for (const email of emails) {
        if (email) {
          await getDataSource().sendEmail('reminder', email, {
            title: event.title,
            message: `Don't forget! The ${event.type} "${event.title}" is coming up on ${event.date} at ${event.startTime || 'TBD'}. Location: ${event.location || 'TBD'}.`
          });
          sent++;
        }
      }
      if (Platform.OS === 'web') alert(`Reminders Sent: Successfully sent ${sent} reminder(s).`);
      else Alert.alert('Reminders Sent', `Successfully sent ${sent} reminder(s).`);
    } catch (e: any) {
      if (Platform.OS === 'web') alert(`Error: ${e.message || 'Failed to send reminders.'}`);
      else Alert.alert('Error', e.message || 'Failed to send reminders.');
    } finally {
      setReminding(null);
    }
  };

  return (
    <Screen padded={false}>
      <Header title="Schedule" showBack />
      <View className="px-4 py-3">
        <Button label="+ Add Event" onPress={() => setShowAdd(true)} />
      </View>
      <FlatList
        data={[...season.events].sort((a, b) => a.date.localeCompare(b.date))}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListEmptyComponent={<EmptyState title="No events" message="Add your first event." />}
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
            <View className="flex-row gap-2 mt-2">
              <Button label="Send Reminder" variant="secondary" size="sm" onPress={() => sendReminder(item)} loading={reminding === item.id} />
              <Button label="Delete" variant="ghost" size="sm" onPress={() => deleteEvent.mutate(item.id)} />
            </View>
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
          <Controller control={control} name="date" render={({ field: { onChange, value }, fieldState: { error } }) => (
            <DateField label="Date" value={value} onChange={onChange} placeholder="Select a date" error={error?.message} disablePast />
          )} />
          <Controller control={control} name="startTime" render={({ field: { onChange, value }, fieldState: { error } }) => (
            <TimeField label="Start Time" value={value} onChange={onChange} placeholder="Select a time" error={error?.message} disablePast dateValue={watch('date')} />
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
