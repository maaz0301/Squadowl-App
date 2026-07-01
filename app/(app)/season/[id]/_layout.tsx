import { Tabs, Redirect } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useSeasonQuery } from '@/features/queries';
import { ErrorState, LoadingState } from '@/components/ui';

export default function SeasonLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);

  if (!id) return <Redirect href="/(app)/dashboard" />;
  if (seasonQuery.isLoading) return <LoadingState message="Loading season..." />;
  if (seasonQuery.isError) return <ErrorState message="Could not load season." onRetry={() => seasonQuery.refetch()} />;
  if (!seasonQuery.data) return <Redirect href="/(app)/dashboard" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: 'SpaceGrotesk-Bold', fontSize: 17 },
        tabBarStyle: { backgroundColor: colors.bgSecondary, borderTopColor: colors.border, height: 56, paddingBottom: 6 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: seasonQuery.data.name, tabBarLabel: 'Hub' }} />
      <Tabs.Screen name="roster" options={{ title: seasonQuery.data.name, tabBarLabel: 'Roster' }} />
      <Tabs.Screen name="schedule" options={{ title: seasonQuery.data.name, tabBarLabel: 'Schedule' }} />
      <Tabs.Screen name="calendar" options={{ title: seasonQuery.data.name, tabBarLabel: 'Calendar' }} />
      <Tabs.Screen name="availability" options={{ title: seasonQuery.data.name, tabBarLabel: 'Availability' }} />
      <Tabs.Screen name="attendance" options={{ title: seasonQuery.data.name, tabBarLabel: 'Attendance' }} />
      <Tabs.Screen name="settings" options={{ title: seasonQuery.data.name, tabBarLabel: 'Settings' }} />
      <Tabs.Screen name="player/[playerId]" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
