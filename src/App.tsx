import React, { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import RootNavigator from './navigation/RootNavigator';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppThemeProvider } from './theme/ThemeProvider';
import SplashScreen from 'react-native-splash-screen';
import '../global.css';
import { useAuthStore } from './state/authStore';
import { usePushNotifications } from './hooks/usePushNotifications';

// React Query's "refetch on focus" only listens for browser window-focus
// events out of the box — on native it has to be told when the app itself
// comes back to the foreground, otherwise stale cached data (e.g. the
// dashboard's tryouts/teams) never refreshes until the app is fully relaunched.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

export default function App() {
  // Initialize push notifications and sync user
  usePushNotifications();

  useEffect(() => {
    // Hide the native splash screen once the JS app has booted
    SplashScreen.hide();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <QueryClientProvider client={queryClient}>
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          </QueryClientProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
