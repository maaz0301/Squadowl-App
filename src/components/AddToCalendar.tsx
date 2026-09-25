import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Modal } from '@/components/ui';
import {
  googleCalendarUrl,
  openCalendarUrl,
  outlookCalendarUrl,
  shareIcs,
  type CalendarEvent,
} from '@/lib/calendarLinks';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { SeasonEvent } from '@/data/types';

/**
 * Everything the calendar builders need from an event, and nothing more — a
 * structural subset so a screen holding only part of an event (an RSVP link's
 * context, say) can use this without inventing the fields it lacks.
 */
export type CalendarSource = Pick<
  SeasonEvent,
  'id' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime' | 'location' | 'notes'
>;

/**
 * The UID is the event's own row id, so a copy taken here and an invite that
 * arrives later by email are one entry in the recipient's calendar, not two.
 */
export function toCalendarEvent(
  event: CalendarSource,
  opts: { teamName?: string } = {},
): CalendarEvent {
  const notes = [event.notes, opts.teamName ? `Team: ${opts.teamName}` : undefined]
    .filter(Boolean)
    .join('\n');
  return {
    uid: `season-event-${event.id}@tryouthq.ca`,
    title: opts.teamName ? `${event.title} (${opts.teamName})` : event.title,
    date: event.date,
    endDate: event.endDate,
    startTime: event.startTime || undefined,
    endTime: event.endTime || undefined,
    location: event.location || undefined,
    description: notes || undefined,
  };
}

/**
 * "Add to calendar" for one event.
 *
 * Google and Outlook open their web templates; everything else — Apple
 * Calendar, Outlook on a desktop, a work calendar — goes through the share
 * sheet, which is where the OS offers "Add to Calendar" for an .ics.
 *
 * Worth knowing: the copy this makes is a snapshot. Nothing here subscribes,
 * so a later edit by the coach does not move the entry already in a personal
 * calendar — the emailed invite is the path that updates in place.
 */
export function AddToCalendar({
  event,
  teamName,
  size = 'md',
  renderTrigger,
}: {
  event: CalendarSource;
  teamName?: string;
  size?: 'sm' | 'md';
  /** Draws the button that opens the picker, for screens with their own styling. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const calendarEvent = toCalendarEvent(event, { teamName });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      Alert.alert(
        'Could not open your calendar',
        e instanceof Error ? e.message : 'Please try another option.',
      );
    } finally {
      setBusy(false);
    }
  };

  const options: { key: string; label: string; hint: string; run: () => Promise<void> }[] = [
    {
      key: 'google',
      label: 'Google Calendar',
      hint: 'Opens in your browser',
      run: () => openCalendarUrl(googleCalendarUrl(calendarEvent)),
    },
    {
      key: 'outlook',
      label: 'Outlook',
      hint: 'Opens in your browser',
      run: () => openCalendarUrl(outlookCalendarUrl(calendarEvent)),
    },
    {
      key: 'ics',
      label: 'Apple Calendar / other',
      hint: 'Opens the share sheet',
      run: () => shareIcs(calendarEvent),
    },
  ];

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
      <Pressable
        onPress={() => setOpen(true)}
        // min-h/justify-center at sm matches Button's own sm sizing (see
        // Button.tsx's sizeStyles) — without it, the 📅 emoji's taller line
        // height (a platform quirk, worst on Android) makes this chip render
        // visibly taller than a plain-text Button sitting right next to it.
        className={`rounded-lg border justify-center ${size === 'sm' ? 'px-2.5 py-1.5 min-h-[36px]' : 'px-3.5 py-2.5'}`}
        style={{ backgroundColor: colors.tile, borderColor: colors.border }}
      >
        <Text
          className={`font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
          style={{ color: colors.ink }}
        >
          📅 Add to calendar
        </Text>
      </Pressable>
      )}

      <Modal visible={open} title="Add to calendar" onClose={() => setOpen(false)}>
        <View className="gap-2">
          {options.map((o) => (
            <Pressable
              key={o.key}
              disabled={busy}
              onPress={() => run(o.run)}
              className="rounded-xl border px-4 py-3"
              style={{
                backgroundColor: colors.tile,
                borderColor: colors.border,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Text className="text-base font-bold" style={{ color: colors.ink }}>
                {o.label}
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {o.hint}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}
