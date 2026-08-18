import React, { useCallback, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import WelcomeScreen from '../screens/(onboarding)/welcome';
import WizardScreen from '../screens/(onboarding)/wizard';
import VerifyEmailScreen from '../screens/(auth)/verify-email';
import { useAuthStore } from '@/state/authStore';
import { SplashScreen } from '@/components/ui';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { session, isHydrated } = useAuthStore();
  /**
   * MMKV-backed persist rehydration is synchronous, so `isHydrated` is already
   * true on the very first render — there's no real loading window left to key
   * the splash off of. Instead the brand animation itself owns the timing and
   * reports back here when it has played out (SplashScreen caps how long that
   * can take, so this can't strand the user).
   */
  const [splashFinished, setSplashFinished] = useState(false);
  const handleSplashFinish = useCallback(() => setSplashFinished(true), []);

  if (!isHydrated || !splashFinished) {
    return <SplashScreen onFinish={handleSplashFinish} />;
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
