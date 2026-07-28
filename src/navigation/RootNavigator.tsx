import React, { useState } from 'react';
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
  const [splashPlayed, setSplashPlayed] = useState(false);

  // The intro plays through even if auth hydrates first; if it's still running
  // when hydration finishes, it holds the screen until it ends.
  if (!isHydrated || !splashPlayed) {
    return <SplashScreen onFinish={() => setSplashPlayed(true)} />;
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
