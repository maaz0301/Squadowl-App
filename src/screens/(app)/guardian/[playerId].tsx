import React, { useState } from 'react';
import { FlatList, View, Text, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import {
  Screen,
  Header,
  Card,
  Tabs,
  Avatar,
  EmptyState,
  LoadingState,
  ErrorState,
  Badge,
} from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useGuardianRostersQuery, useSeasonsQuery, useSetAvailabilityMutation } from '@/features/queries';
import type { SeasonEvent } from '@/data/types';

function EventCard({ item, playerId, colors }: { item: SeasonEvent & { seasonName: string; teamName: string; seasonId: string }, playerId: string, colors: any }) {
  const rsvpMutation = useSetAvailabilityMutation(item.seasonId);
  const rsvp = item.availability?.[playerId] || 'pending';

  return (
    <Card className="mb-3">
      <View className="flex-row justify-between items-start mb-2">
        <View className="flex-1">
          <Text className="text-base font-bold" style={{ color: colors.ink }}>
            {item.title}
          </Text>
          <Text className="text-sm" style={{ color: colors.primary }}>
            {item.seasonName}
          </Text>
        </View>
        <Badge label={item.type} variant="info" />
      </View>
      
      <View className="flex-row items-center gap-2 mt-1">
        <Text className="text-sm font-medium" style={{ color: colors.inkMuted }}>
          📅 {item.date}
        </Text>
        {(item.startTime || item.endTime) && (
          <Text className="text-sm font-medium" style={{ color: colors.inkMuted }}>
            · 🕒 {item.startTime} {item.endTime ? `- ${item.endTime}` : ''}
          </Text>
        )}
      </View>
      {item.location ? (
        <Text className="text-sm font-medium mt-1" style={{ color: colors.inkMuted }}>
          📍 {item.location}
        </Text>
      ) : null}

      <View className="mt-4 pt-3 border-t" style={{ borderTopColor: colors.border }}>
        <Text className="text-sm font-bold mb-2" style={{ color: colors.inkMuted }}>RSVP</Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => rsvpMutation.mutate({ eventId: item.id, playerId, response: 'yes' })}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'yes' ? colors.success : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'yes' ? '#fff' : colors.ink }}>Yes</Text>
          </Pressable>
          <Pressable
            onPress={() => rsvpMutation.mutate({ eventId: item.id, playerId, response: 'maybe' })}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'maybe' ? colors.warning : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'maybe' ? '#fff' : colors.ink }}>Maybe</Text>
          </Pressable>
          <Pressable
            onPress={() => rsvpMutation.mutate({ eventId: item.id, playerId, response: 'no' })}
            className="flex-1 py-2 items-center rounded-md"
            style={{ backgroundColor: rsvp === 'no' ? colors.error : colors.tile }}
          >
            <Text className="font-bold" style={{ color: rsvp === 'no' ? '#fff' : colors.ink }}>No</Text>
          </Pressable>
        </View>
      </View>
    </Card>
  );
}

export default function GuardianPortalScreen() {
  const route = useRoute<any>();
  const playerId = route.params?.playerId;
  const colors = useThemeColors();
  const [tab, setTab] = useState('overview');

  const guardianQuery = useGuardianRostersQuery();
  const seasonsQuery = useSeasonsQuery();

  if (guardianQuery.isLoading || seasonsQuery.isLoading) {
    return <LoadingState message="Loading portal..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load player details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);

  if (!athlete) {
    return (
      <Screen>
        <Header title="Guardian Portal" showBack />
        <EmptyState title="Player not found" message="We couldn't find this player in your roster." />
      </Screen>
    );
  }

  // Aggregate events from the seasons the athlete is enrolled in
  let allEvents: (SeasonEvent & { seasonName: string; teamName: string; seasonId: string })[] = [];
  
  if (seasonsQuery.data) {
    const athleteSeasonIds = new Set(athlete.seasons.map((s) => s.id));
    const athleteSeasons = seasonsQuery.data.filter((s) => athleteSeasonIds.has(s.id));
    
    athleteSeasons.forEach((season) => {
      season.events.forEach((event) => {
        allEvents.push({
          ...event,
          seasonName: season.name,
          teamName: season.teamName,
          seasonId: season.id,
        });
      });
    });
    
    // Sort chronologically (assuming event.date is ISO string or YYYY-MM-DD)
    allEvents.sort((a, b) => {
      const aDate = new Date(`${a.date}T${a.startTime || '00:00'}`).getTime();
      const bDate = new Date(`${b.date}T${b.startTime || '00:00'}`).getTime();
      return aDate - bDate;
    });
  }

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2">
        <Header title="Guardian Portal" showBack />
        
        <View className="flex-row items-center gap-4 mb-4 mt-2">
          <Avatar first={athlete.firstName} last={athlete.lastName} size={64} />
          <View>
            <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
              {athlete.firstName} {athlete.lastName}
            </Text>
            <Text className="text-base mt-1" style={{ color: colors.inkMuted }}>
              {athlete.tryouts.length + athlete.seasons.length} Active Assignments
            </Text>
          </View>
        </View>

        <Tabs
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'schedule', label: 'Schedule', badge: allEvents.length || undefined },
            { key: 'info', label: 'Info' },
          ]}
          activeKey={tab}
          onChange={setTab}
          className="mb-4"
        />
      </View>

      {tab === 'overview' ? (
        <FlatList
          data={[
            ...athlete.seasons.map((s) => ({ ...s, _type: 'season' as const })),
            ...athlete.tryouts.map((t) => ({ ...t, _type: 'tryout' as const })),
          ]}
          keyExtractor={(item) => `${item._type}-${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No assignments"
              message="This athlete isn't assigned to any tryouts or seasons yet."
            />
          }
          renderItem={({ item }) => (
            <Card accent className="mb-3">
              <View className="flex-row justify-between items-start">
                <View className="flex-1">
                  <Text className="text-lg font-display font-bold mb-1" style={{ color: colors.ink }}>
                    {item.name}
                  </Text>
                  {item._type === 'season' ? (
                    <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
                      {item.teamName} · {item.sport}
                    </Text>
                  ) : (
                    <Text className="text-sm mb-2" style={{ color: colors.inkMuted }}>
                      Tryout · {item.sport}
                    </Text>
                  )}
                </View>
                <Badge label={item._type === 'season' ? 'Season' : 'Tryout'} variant={item._type === 'season' ? 'info' : 'brand'} />
              </View>
            </Card>
          )}
        />
      ) : tab === 'schedule' ? (
        <FlatList
          data={allEvents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              title="No events scheduled"
              message="There are no upcoming events for this athlete."
            />
          }
          renderItem={({ item }) => <EventCard item={item} playerId={playerId} colors={colors} />}
        />
      ) : (
        <View className="px-4">
          <Card className="mb-3">
            <Text className="text-lg font-bold mb-2" style={{ color: colors.ink }}>
              Basic Information
            </Text>
            <View className="flex-row justify-between py-2 border-b" style={{ borderBottomColor: colors.border }}>
              <Text style={{ color: colors.inkMuted }}>First Name</Text>
              <Text className="font-medium" style={{ color: colors.ink }}>{athlete.firstName}</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text style={{ color: colors.inkMuted }}>Last Name</Text>
              <Text className="font-medium" style={{ color: colors.ink }}>{athlete.lastName}</Text>
            </View>
          </Card>
          
          <Card>
             <Text className="text-lg font-bold mb-2" style={{ color: colors.ink }}>
              Account Link
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              This athlete is linked to your guardian account. You will receive notifications and updates regarding their tryouts and team events.
            </Text>
          </Card>
        </View>
      )}
    </Screen>
  );
}
