import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/state/authStore';
import { LoadingState } from '@/components/ui';

export default function AppLayout() {
  const session = useAuthStore((s) => s.session);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  if (!isHydrated) return <LoadingState />;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="upgrade" />
      <Stack.Screen name="enterprise" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="assessment/new" />
      <Stack.Screen name="assessment/[id]" />
      <Stack.Screen name="season/new" />
      <Stack.Screen name="season/[id]" />
      <Stack.Screen name="search" />
      <Stack.Screen name="feedback" />
      <Stack.Screen name="friend-packages" />
      <Stack.Screen name="archived-assessments" />
      <Stack.Screen name="combine" />
      <Stack.Screen name="team/new" />
      <Stack.Screen name="team/[id]" />
    </Stack>
  );
}
