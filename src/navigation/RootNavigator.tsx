import React from 'react';
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

  if (!isHydrated) {
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
