import { useState, useEffect, useRef } from 'react';
import { FlatList, Text, View, ScrollView, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { TeamBanner } from '@/components/TeamBanner';
import { useSeasonTeamBrand } from '@/features/useTeamBrand';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Modal, Screen, DateField, TimeField, Header } from '@/components/ui';
import { useSeasonQuery, useAddSeasonEventMutation, useUpdateSeasonEventMutation, useDeleteSeasonEventMutation } from '@/features/queries';
import { getDataSource } from '@/data';
import { Alert, Platform } from 'react-native';

export default function SeasonScheduleScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const addEvent = useAddSeasonEventMutation(id!);
  const updateEvent = useUpdateSeasonEventMutation(id!);
  const deleteEvent = useDeleteSeasonEventMutation(id!);
  const [showAdd, setShowAdd] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  const { control, handleSubmit, watch, setValue, reset, setError } = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '', playerIds: [] },
  });

  // Called before the loading/error guards below: it's a hook, and skipping it
  // on the loading render would change hook order between renders. It accepts
  // an undefined season and returns the plain theme.
  const { team, brand } = useSeasonTeamBrand(seasonQuery.data);

  if (seasonQuery.isLoading) return <LoadingState message="Loading schedule..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load schedule." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;
  const eventType = watch('type');

  useEffect(() => {
    if (showAdd && !editingEventId && season?.roster) {
      setSelectedPlayerIds(season.roster.map((p) => p.id));
    }
  }, [showAdd, editingEventId, season?.roster]);

  const openAdd = () => {
    setEditingEventId(null);
    reset({ type: 'Practice', title: '', date: '', startTime: '', endTime: '', location: '', notes: '', playerIds: [] });
    setShowAdd(true);
  };

  const openEdit = (event: import('@/data/types').SeasonEvent) => {
    setEditingEventId(event.id);
    reset({
      type: event.type,
      title: event.title,
      date: event.date,
      startTime: event.startTime ?? '',
      endTime: event.endTime ?? '',
      location: event.location ?? '',
      notes: event.notes ?? '',
      playerIds: [],
    });
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditingEventId(null);
    reset();
  };

  // If navigated here with an editEventId (e.g. from the Season Hub's Upcoming
  // Events), open that event in the edit modal once, after the season loads.
  const editParamHandled = useRef(false);
  useEffect(() => {
    if (editParamHandled.current) return;
    const editId = route.params?.editEventId;
    if (!editId) return;
    const ev = season.events.find((e) => e.id === editId);
    if (ev) {
      editParamHandled.current = true;
      openEdit(ev);
    }
  }, [route.params?.editEventId, season.events]);

  const onSubmit = handleSubmit(
    async (data) => {
      // Validate that event is scheduled from today (current time) onwards
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

      if (editingEventId) {
        await updateEvent.mutateAsync({
          eventId: editingEventId,
          updates: {
            type: data.type,
            title: data.title,
            date: data.date,
            startTime: data.startTime,
            endTime: data.endTime,
            location: data.location,
            notes: data.notes,
          },
        });
      } else {
        await addEvent.mutateAsync({
          ...data,
          playerIds: selectedPlayerIds,
        });
      }
      closeModal();
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
      const assignedRosterIds = new Set(Object.keys(event.availability || {}));
      const emails = Array.from(new Set(
        season.roster
          .filter(p => assignedRosterIds.has(p.id))
          .flatMap(p => [p.playerEmail, p.guardianEmail, ...(p.portalInviteEmails ?? [])])
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
    <Screen padded={false} backgroundColor={brand.screenBg}>
      <Header title="Schedule" showBack />
      {/* Same banner as the team hub, so a coach deep in the schedule still sees
          whose team it belongs to. Tapping it goes back to the hub. */}
      {team ? <TeamBanner team={team} className="px-4 mb-2" /> : null}
      <View className="px-4 py-3">
        <Button label="+ Add Event" onPress={openAdd} />
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
              <Button label="Edit" variant="secondary" size="sm" onPress={() => openEdit(item)} />
              <Button label="Delete" variant="ghost" size="sm" onPress={() => deleteEvent.mutate(item.id)} />
            </View>
          </Card>
        )}
      />

      <Modal visible={showAdd} title={editingEventId ? 'Edit Event' : 'Add Event'} onClose={closeModal}>
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
          {editingEventId ? null : (
            <>
              <Text className="font-bold text-xs uppercase tracking-wider mt-2" style={{ color: colors.inkMuted }}>
                Roster Assignment ({selectedPlayerIds.length}/{season.roster.length})
              </Text>
              <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                {season.roster.map((player) => {
                  const isSelected = selectedPlayerIds.includes(player.id);
                  return (
                    <Pressable
                      key={player.id}
                      onPress={() => {
                        if (isSelected) {
                          setSelectedPlayerIds(selectedPlayerIds.filter(id => id !== player.id));
                        } else {
                          setSelectedPlayerIds([...selectedPlayerIds, player.id]);
                        }
                      }}
                      className="flex-row items-center justify-between py-2 border-b"
                      style={{ borderColor: colors.border }}
                    >
                      <Text style={{ color: colors.ink }}>
                        {player.firstName} {player.lastName}
                      </Text>
                      <Badge
                        label={isSelected ? 'Selected' : 'Deselected'}
                        variant={isSelected ? 'success' : 'default'}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}
          <Button label={editingEventId ? 'Update Event' : 'Save Event'} onPress={onSubmit} loading={addEvent.isPending || updateEvent.isPending} />
        </View>
      </Modal>
    </Screen>
  );
}
