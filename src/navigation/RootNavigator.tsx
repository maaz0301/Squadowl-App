import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import WelcomeScreen from '../screens/(onboarding)/welcome';
import WizardScreen from '../screens/(onboarding)/wizard';
import VerifyEmailScreen from '../screens/(auth)/verify-email';
import { useAuthStore } from '@/state/authStore';
import { SplashScreen } from '@/components/ui';

/**
 * MMKV-backed persist rehydration is synchronous, so `isHydrated` is already
 * true on the very first render — there's no real loading window left to key
 * the splash off of. This timer gives the brand splash a minimum, deliberate
 * moment on screen instead of never appearing at all.
 */
const MIN_SPLASH_MS = 1200;

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { session, isHydrated } = useAuthStore();
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!isHydrated || !minTimeElapsed) {
    return <SplashScreen />;
  }

  const isEmailUnverified = session?.user && session.user.emailVerified === false;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {session ? (
        isEmailUnverified ? (
          <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
        ) : (
          <>
            <Stack.Screen name="App" component={AppNavigator} />
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Wizard" component={WizardScreen} />
          </>
        )
      ) : (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      )}
    </Stack.Navigator>
  );
}
