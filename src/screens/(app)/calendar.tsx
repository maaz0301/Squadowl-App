import { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { BottomNav } from '@/components/BottomNav';
import { MonthCalendar } from '@/components/MonthCalendar';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Modal, Screen } from '@/components/ui';
import { useSeasonsQuery, useSetTeamCalendarLinkMutation, useTeamCalendarLinksQuery, useTeamsQuery } from '@/features/queries';
import { groupCalendarTeams, withAllTeams } from '@/lib/teamCalendars';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Every team's events on one month calendar, each marked with its team, plus which calendars are attached to which teams. */
export default function CalendarScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const seasonsQuery = useSeasonsQuery();
  const linksQuery = useTeamCalendarLinksQuery();
  const setLink = useSetTeamCalendarLinkMutation();
  // The calendar whose "shows on" list is being edited.
  const [managingId, setManagingId] = useState<string | null>(null);

  const seasons = seasonsQuery.data;
  const teamsQuery = useTeamsQuery();
  const allTeams = teamsQuery.data;
  const refreshControl = usePullToRefresh(() =>
    Promise.all([seasonsQuery.refetch(), linksQuery.refetch(), teamsQuery.refetch()]),
  );
  const teams = useMemo(
    () => withAllTeams(groupCalendarTeams(seasons ?? []), allTeams ?? []),
    [seasons, allTeams],
  );
  const { events, teamByEvent, teamIdByEvent } = useMemo(() => {
    const teamByEvent = new Map<string, string>();
    const teamIdByEvent = new Map<string, string>();
    const events = (seasons ?? []).flatMap((s) => {
      for (const ev of s.events) {
        teamByEvent.set(ev.id, s.teamName);
        if (s.teamId) teamIdByEvent.set(ev.id, s.teamId);
      }
      return s.events;
    });
    return { events, teamByEvent, teamIdByEvent };
  }, [seasons]);

  const links = linksQuery.data ?? [];
  const nameOf = (teamId: string) => teams.find((t) => t.teamId === teamId)?.teamName ?? 'Team';
  const managing = teams.find((t) => t.teamId === managingId);

  const toggle = (viewerTeamId: string, sourceTeamId: string, attached: boolean) =>
    setLink.mutate(
      { viewerTeamId, sourceTeamId, attached },
      { onError: (e) => Alert.alert('Could not update calendar', e instanceof Error ? e.message : 'Please try again.') },
    );

  return (
    <Screen padded={false}>
      <Header title="Calendar" showBack />
      {seasonsQuery.isLoading ? (
        <LoadingState />
      ) : seasonsQuery.isError ? (
        <ErrorState message="Could not load the calendar." onRetry={() => seasonsQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={refreshControl}>
          {teams.length > 1 ? (
            <View className="mb-5">
              <Text className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Your calendars</Text>
              {teams.map((t) => {
                const shownOn = links.filter((l) => l.sourceTeamId === t.teamId).map((l) => nameOf(l.viewerTeamId));
                return (
                  <Card key={t.teamId} className="mb-2 flex-row items-center gap-3">
                    <View className="flex-1">
                      <Text className="font-bold" numberOfLines={1} style={{ color: colors.ink }}>{t.teamName}</Text>
                      <Text className="text-sm" style={{ color: colors.inkMuted }}>
                        {t.events.length} {t.events.length === 1 ? 'event' : 'events'}
                        {shownOn.length > 0 ? ` · also shown on ${shownOn.join(', ')}` : ' · not attached to other teams'}
                      </Text>
                    </View>
                    {shownOn.length > 0 ? <Badge label={`On ${shownOn.length}`} variant="brand" /> : null}
                    <Button label="Attach" variant="secondary" onPress={() => setManagingId(t.teamId)} />
                  </Card>
                );
              })}
            </View>
          ) : null}

          {teams.length === 1 ? (
            <Text className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
              Attaching calendars shows up once you have a second team.
            </Text>
          ) : null}

          <MonthCalendar
            events={events}
            teamNameFor={(ev) => teamByEvent.get(ev.id)}
            onOpenEvent={(ev) => {
              const teamId = teamIdByEvent.get(ev.id);
              if (teamId) navigation.navigate('TeamDetail', { id: teamId, tab: 'schedule', eventId: ev.id });
            }}
          />
        </ScrollView>
      )}

      <Modal visible={!!managing} title={managing ? `${managing.teamName} calendar` : ''} onClose={() => setManagingId(null)}>
        {managing ? (
          <View className="gap-2">
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Choose the teams whose Calendar should also show {managing.teamName}'s events. Disconnecting only stops them
              showing; no events are changed.
            </Text>
            {teams
              .filter((t) => t.teamId !== managing.teamId)
              .map((t) => {
                const attached = links.some((l) => l.viewerTeamId === t.teamId && l.sourceTeamId === managing.teamId);
                return (
                  <View
                    key={t.teamId}
                    className="flex-row items-center gap-3 rounded-lg border px-3 py-2"
                    style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                  >
                    <Text className="flex-1 text-sm font-semibold" numberOfLines={1} style={{ color: colors.ink }}>{t.teamName}</Text>
                    <Button
                      label={attached ? 'Disconnect' : 'Attach'}
                      variant={attached ? 'secondary' : 'primary'}
                      loading={
                        setLink.isPending &&
                        setLink.variables?.viewerTeamId === t.teamId &&
                        setLink.variables?.sourceTeamId === managing.teamId
                      }
                      onPress={() => toggle(t.teamId, managing.teamId, !attached)}
                    />
                  </View>
                );
              })}
          </View>
        ) : null}
      </Modal>
      <BottomNav active="calendar" />
    </Screen>
  );
}
