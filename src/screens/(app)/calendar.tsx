import { useMemo } from 'react';
import { ScrollView } from 'react-native';

import { BottomNav } from '@/components/BottomNav';
import { MonthCalendar } from '@/components/MonthCalendar';
import { ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSeasonsQuery } from '@/features/queries';

/** Every team's events on one month calendar, each marked with its team. */
export default function CalendarScreen() {
  const seasonsQuery = useSeasonsQuery();

  const { events, teamByEvent } = useMemo(() => {
    const teamByEvent = new Map<string, string>();
    const events = (seasonsQuery.data ?? []).flatMap((s) => {
      for (const ev of s.events) teamByEvent.set(ev.id, s.teamName);
      return s.events;
    });
    return { events, teamByEvent };
  }, [seasonsQuery.data]);

  return (
    <Screen padded={false}>
      <Header title="Calendar" showBack />
      {seasonsQuery.isLoading ? (
        <LoadingState />
      ) : seasonsQuery.isError ? (
        <ErrorState message="Could not load the calendar." onRetry={() => seasonsQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <MonthCalendar events={events} teamNameFor={(ev) => teamByEvent.get(ev.id)} />
        </ScrollView>
      )}
      <BottomNav active="calendar" />
    </Screen>
  );
}
