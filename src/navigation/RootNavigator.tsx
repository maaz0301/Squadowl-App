import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import WelcomeScreen from '../screens/(onboarding)/welcome';
import WizardScreen from '../screens/(onboarding)/wizard';
import { useAuthStore } from '@/state/authStore';
import { SplashScreen } from '@/components/ui';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { session, isHydrated } = useAuthStore();

  if (!isHydrated) {
    return <SplashScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {session ? (
        <>
          <Stack.Screen name="App" component={AppNavigator} />
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Wizard" component={WizardScreen} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      )}
    </Stack.Navigator>
  );
}
