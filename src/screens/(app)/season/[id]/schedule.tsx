import { useState, useEffect, useRef } from 'react';
import { FlatList, Text, View, ScrollView, Pressable, Alert, Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm, type SeasonEvent } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { TeamBanner } from '@/components/TeamBanner';
import { useSeasonTeamBrand } from '@/features/useTeamBrand';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Input, LoadingState, Modal, Screen, DateField, TimeField, Header } from '@/components/ui';
import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink, MapLocationHint } from '@/components/MapLink';
import { useSeasonQuery, useAddSeasonEventMutation, useUpdateSeasonEventMutation, useDeleteSeasonEventMutation } from '@/features/queries';
import { getDataSource } from '@/data';

/** Alert.alert is a no-op on react-native-web, so fall back to the DOM dialog. */
function notify(title: string, message: string) {
  if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function confirmAsync(opts: { title: string; message: string; confirmLabel: string; destructive?: boolean }) {
  return new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') {
      resolve(confirm(`${opts.title}\n\n${opts.message}`));
      return;
    }
    Alert.alert(opts.title, opts.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: opts.confirmLabel,
        style: opts.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

export default function SeasonScheduleScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const [eventProgress, setEventProgress] = useState<{ done: number; total: number } | null>(null);
  const addEvent = useAddSeasonEventMutation(id!, (done, total) => setEventProgress({ done, total }));
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
  const eventType = watch('type');

  // Called before the loading/error guards below: it's a hook, and skipping it
  // on the loading render would change hook order between renders. It accepts
  // an undefined season and returns the plain theme.
  const { team, brand } = useSeasonTeamBrand(seasonQuery.data);

  // Likewise every hook below: the season is undefined on the first render and
  // the guards return early, so anything hook-shaped has to sit above them or
  // React sees a different hook count once the query resolves.
  const season = seasonQuery.data;

  useEffect(() => {
    if (showAdd && !editingEventId && season?.roster) {
      setSelectedPlayerIds(season.roster.map((p) => p.id));
    }
  }, [showAdd, editingEventId, season?.roster]);

  const openAdd = () => {
    setEditingEventId(null);
    setEventProgress(null);
    reset({ type: 'Practice', title: '', date: '', startTime: '', endTime: '', location: '', notes: '', playerIds: [] });
    setShowAdd(true);
  };

  const openEdit = (event: SeasonEvent) => {
    setEditingEventId(event.id);
    setEventProgress(null);
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
    setEventProgress(null);
    reset();
  };

  // If navigated here with an editEventId (e.g. from the Season Hub's Upcoming
  // Events), open that event in the edit modal once, after the season loads.
  const editParamHandled = useRef(false);
  useEffect(() => {
    if (editParamHandled.current || !season) return;
    const editId = route.params?.editEventId;
    if (!editId) return;
    const ev = season.events.find((e) => e.id === editId);
    if (ev) {
      editParamHandled.current = true;
      openEdit(ev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.editEventId, season]);

  if (seasonQuery.isLoading) return <LoadingState message="Loading schedule..." />;
  if (seasonQuery.isError || !season) {
    return <ErrorState message="Could not load schedule." onRetry={() => seasonQuery.refetch()} />;
  }

  const onSubmit = handleSubmit(
    async (data) => {
      // Validate that event is scheduled from today (current time) onwards
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      const eventDate = new Date(y, m - 1, d, hour, min);

      if (eventDate < new Date()) {
        const msg = 'Event must be scheduled from today onwards.';
        setError('date', { type: 'manual', message: msg });
        notify('Validation Error', msg);
        return;
      }

      try {
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
          await addEvent.mutateAsync({ ...data, playerIds: selectedPlayerIds });
        }
        closeModal();
      } catch (e) {
        notify('Error', e instanceof Error ? e.message : 'Could not save the event.');
      }
    },
    (errors) => {
      const msg = errors.date?.message || errors.title?.message || 'Please check the required fields and date format.';
      notify('Validation Error', msg);
    }
  );

  const sendReminder = async (event: SeasonEvent) => {
    // Recipients are derived from the RSVP rows, so a failed availability read
    // would otherwise look like an event with nobody on it and report "no
    // guardians with emails" — while the invited roster sits there unreminded.
    if (event.availabilityUnavailable && Object.keys(event.availability ?? {}).length === 0) {
      notify(
        'RSVPs Unavailable',
        "This event's invite list couldn't be loaded, so there's no way to tell who to remind. Reload and try again."
      );
      return;
    }
    // A partial list can still be reminded — just say so, rather than quietly
    // skipping the players whose rows never arrived.
    if (event.availabilityUnavailable) {
      const proceed = await confirmAsync({
        title: 'Partial Invite List',
        message: "Some of this event's RSVPs couldn't be loaded. Remind only the players that did load?",
        confirmLabel: 'Send Anyway',
      });
      if (!proceed) return;
    }
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
        notify('No Emails', 'There are no guardians with emails in the roster.');
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
      notify('Reminders Sent', `Successfully sent ${sent} reminder(s).`);
    } catch (e) {
      notify('Error', e instanceof Error ? e.message : 'Failed to send reminders.');
    } finally {
      setReminding(null);
    }
  };

  const confirmDeleteEvent = async (eventId: string, label: string) => {
    const ok = await confirmAsync({
      title: 'Delete Event',
      message: `Delete "${label}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteEvent.mutate(eventId);
  };

  const formBusy = addEvent.isPending || updateEvent.isPending;

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
            {item.location ? (
              <Text style={{ color: colors.inkFaint }}>
                <MapLink location={item.location} label={item.title} variant="inline" />
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2 mt-2 items-center">
              {/* No size="sm" on these two: Button's own text stays text-base at every
                  size (see Button.tsx), so its "sm" already renders taller than these
                  chips' text-xs "sm". Their default (md) size lands at the same actual
                  height as Button's "sm" — this is the match, not a mismatch to fix later. */}
              <AddToCalendar event={item} teamName={season.teamName} />
              <MapLink location={item.location} label={item.title} />
              <Button label="Send Reminder" variant="secondary" size="sm" onPress={() => sendReminder(item)} loading={reminding === item.id} />
              <Button label="Edit" variant="secondary" size="sm" onPress={() => openEdit(item)} />
              <Button
                label="Delete"
                variant="danger"
                size="sm"
                loading={deleteEvent.isPending && deleteEvent.variables === item.id}
                onPress={() => confirmDeleteEvent(item.id, item.title)}
              />
            </View>
          </Card>
        )}
      />

      <Modal visible={showAdd} title={editingEventId ? 'Edit Event' : 'Add Event'} onClose={closeModal}>
        <View className="gap-3">
          {/* Freezes the fields while a save is in flight — the submit button
              stays outside so its spinner and the progress bar below it don't
              get dimmed along with them. */}
          <View
            className="gap-3"
            style={{ pointerEvents: formBusy ? 'none' : 'auto', opacity: formBusy ? 0.6 : 1 }}
          >
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
              <View>
                <Input
                  label="Location"
                  placeholder="Venue and street address"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                />
                <MapLocationHint location={value} />
              </View>
            )} />
            {editingEventId ? null : (
              <>
                <Text className="font-bold text-xs uppercase tracking-wider mt-2" style={{ color: colors.inkMuted }}>
                  Roster Assignment
                  {season.rosterPending ? '' : ` (${selectedPlayerIds.length}/${season.roster.length})`}
                </Text>
                {/* The season's events arrive before its roster (see
                    getSeason), so the picker can open on a roster that hasn't
                    loaded. Saying so beats an empty list that looks like a team
                    with no players — and the save is blocked below, since an
                    event saved here invites exactly who is selected. */}
                {season.rosterPending ? (
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>Loading roster...</Text>
                ) : null}
                <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
                  {season.roster.map((player) => {
                    const isSelected = selectedPlayerIds.includes(player.id);
                    return (
                      <Pressable
                        key={player.id}
                        onPress={() => {
                          if (isSelected) {
                            setSelectedPlayerIds(selectedPlayerIds.filter(pid => pid !== player.id));
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
          </View>

          {addEvent.isPending && eventProgress && eventProgress.total > 0 ? (
            <View className="gap-1">
              <View className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: colors.tile }}>
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((eventProgress.done / eventProgress.total) * 100)))}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
              <Text className="text-center text-xs" style={{ color: colors.inkMuted }}>
                {`Inviting ${eventProgress.done} of ${eventProgress.total} players...`}
              </Text>
            </View>
          ) : null}

          <Button
            label={editingEventId ? 'Update Event' : 'Save Event'}
            onPress={onSubmit}
            loading={formBusy}
            disabled={!editingEventId && !!season.rosterPending}
          />
        </View>
      </Modal>
    </Screen>
  );
}
