import { Redirect } from 'expo-router';
import { useAuthStore } from '@/state/authStore';
import { useOnboardingStore } from '@/state/uiStore';
import { LoadingState } from '@/components/ui';

export default function Index() {
  const session = useAuthStore((s) => s.session);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const wizardCompleted = useOnboardingStore((s) => s.wizardCompleted);
  const wizardSkipped = useOnboardingStore((s) => s.wizardSkipped);

  if (!isHydrated) {
    return <LoadingState message="Starting up..." />;
  }

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!wizardCompleted && !wizardSkipped && !session.user.onboardingCompleted) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return <Redirect href="/(app)/dashboard" />;
}
