import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { MapLink } from '@/components/MapLink';
import { TeamBanner } from '@/components/TeamBanner';
import { ChatIconButton } from '@/components/ChatIconButton';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';
import { useSeasonTeamBrand } from '@/features/useTeamBrand';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';

export default function SeasonHubScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const seasonQuery = useSeasonQuery(id);

  // Hook, so it runs before the loading/error guards — skipping it on the
  // loading render would change hook order. Undefined season -> plain theme.
  const { team, brand } = useSeasonTeamBrand(seasonQuery.data);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return (
      <Screen scroll>
        <Header title="Season" showBack />
        <ErrorState message="Could not load season hub." onRetry={() => seasonQuery.refetch()} />
      </Screen>
    );
  }
  const season = seasonQuery.data;

  const upcoming = [...season.events]
    .filter((e) => e.date >= new Date().toISOString().split('T')[0])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return (
    <Screen scroll backgroundColor={brand.screenBg}>
      <Header
        title="Season Hub"
        showBack
        right={
          <View className="flex-row items-center gap-1">
            <ChatIconButton
              badge={<ChatUnreadBadge seasonId={id} />}
              onPress={() =>
                navigation.navigate('TeamChat', {
                  seasonId: id,
                  title: `${season.teamName} Chat`,
                  subtitle: `${season.sport} · ${season.year}`,
                  noSeasonMessage:
                    "This team doesn't have a season yet. Add a practice or game under Schedule, and the chat opens for everyone on the roster and their guardians.",
                })
              }
            />
            <Button
              label="Settings"
              variant="ghost"
              size="sm"
              onPress={() => navigation.navigate('SeasonSettings', { id: id })}
            />
          </View>
        }
      />
      {team ? <TeamBanner team={team} className="mb-3" /> : null}
      <Card accent className="mb-4 gap-2">
        <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
          {season.teamName}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {season.sport} · {season.year} · {season.division ?? '—'}
        </Text>
        {season.coach ? <Text style={{ color: colors.inkFaint }}>Coach: {season.coach}</Text> : null}
      </Card>

      <View className="flex-row gap-2 mb-4">
        <Pressable onPress={() => navigation.navigate('SeasonRoster', { id: id })}>
          {/* The roster lands a stage after the events do — see getSeason. */}
          <Badge
            label={season.rosterPending ? 'Players...' : `${season.roster.length} players`}
            variant="brand"
          />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('SeasonSchedule', { id: id })}>
          <Badge label={`${season.events.length} events`} />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('SeasonAttendance', { id: id })}>
          <Badge label="Attendance" variant="info" />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('SeasonCalendar', { id: id })}>
          <Badge label="Calendar" />
        </Pressable>
      </View>

      <View className="flex-row gap-2 mb-4">
        <Button
          label="Adjust Attendance"
          variant="secondary"
          size="sm"
          onPress={() => navigation.navigate('SeasonAvailability', { id: id })}
        />
      </View>

      <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
        Upcoming Events
      </Text>
      {upcoming.length === 0 ? (
        <Card className="mb-4">
          <Text style={{ color: colors.inkMuted }}>No upcoming events. Add one in Schedule.</Text>
        </Card>
      ) : (
        upcoming.map((ev) => (
          <Card key={ev.id} className="mb-2">
            <View className="flex-row justify-between">
              <Text className="font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
              <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {ev.date} · {ev.startTime ?? '—'} ·{' '}
              {ev.location ? (
                <MapLink location={ev.location} label={ev.title} variant="inline" />
              ) : (
                'TBD'
              )}
            </Text>
            <View className="flex-row mt-2 gap-2 items-center">
              <Button
                label="Edit"
                variant="secondary"
                size="sm"
                onPress={() => navigation.navigate('SeasonSchedule', { id: id, editEventId: ev.id })}
              />
              <MapLink location={ev.location} label={ev.title} size="sm" />
            </View>
          </Card>
        ))
      )}

      <Button label="Add Event" variant="secondary" onPress={() => navigation.navigate('SeasonSchedule', { id: id })} />
    </Screen>
  );
}
