import { Tabs, Redirect } from 'expo-router';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useTryoutQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { LoadingState } from '@/components/ui';
import { useEffect } from 'react';

export default function AssessmentLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  useEffect(() => {
    if (id) setCurrentTryout(id);
  }, [id, setCurrentTryout]);

  if (!id) return <Redirect href="/(app)/dashboard" />;
  if (tryoutQuery.isLoading) return <LoadingState message="Loading assessment..." />;
  if (!tryoutQuery.data) return <Redirect href="/(app)/dashboard" />;

  const pendingRegs =
    tryoutQuery.data.registrations?.filter((r) => r.status === 'pending').length ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.bgSecondary },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontFamily: 'SpaceGrotesk-Bold', fontSize: 17 },
        tabBarStyle: {
          backgroundColor: colors.bgSecondary,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="roster"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Roster',
        }}
      />
      <Tabs.Screen
        name="registrations"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Registrations',
          tabBarBadge: pendingRegs > 0 ? pendingRegs : undefined,
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Results',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Settings',
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Export',
        }}
      />
      <Tabs.Screen
        name="rubrics"
        options={{
          title: tryoutQuery.data.name,
          tabBarLabel: 'Rubrics',
        }}
      />
      <Tabs.Screen name="player/[playerId]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="score/[playerId]" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="rinkside" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="team-builder" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="compare" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="roster-library" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="scan-sheet" options={{ href: null, headerShown: false }} />
    </Tabs>
  );
}
