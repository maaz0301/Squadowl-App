import React, { useEffect } from 'react';
import { AppState, type AppStateStatus, LogBox, Platform } from 'react-native';
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
import { getSupabase } from './lib/supabase';
import { usePushNotifications } from './hooks/usePushNotifications';

// react-native-keyboard-aware-scroll-view (used by every <Screen scroll>
// screen, e.g. login/signup/forgot-password) polls whether the focused
// TextInput's native view still exists on every keyboard show/hide/frame
// event. On Fabric that shadow-node lookup can lose a race when the screen
// blurs or unmounts mid-transition — RN's own UIManager already guards this
// case and no-ops (the message says so), so nothing is actually broken, but
// it logs via console.error and hijacks the screen as a full LogBox overlay.
// Ignoring only this exact message, not console.error generally, so a real
// error still surfaces normally. Revisit if the library (0.9.5, stale
// relative to RN 0.85's Fabric default) is ever upgraded or replaced.
LogBox.ignoreLogs(['viewIsDescendantOf() noop']);

// React Query's "refetch on focus" only listens for browser window-focus
// events out of the box — on native it has to be told when the app itself
// comes back to the foreground, otherwise stale cached data (e.g. the
// dashboard's tryouts/teams) never refreshes until the app is fully relaunched.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
  if (status === 'active') {
    // session.user (plan tier, subscription status, etc.) is persisted on-device and
    // otherwise only refreshed by a handful of screens (Upgrade, Payments) — without
    // this, a plan change made outside the app (Stripe webhook, admin override, a
    // support fix) stays invisible until the user happens to visit one of those.
    void useAuthStore.getState().restoreSession(true);
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
    // Cold start: rehydrate from the persisted session immediately, then refresh
    // it against the DB in case the plan/subscription changed since last launch.
    void useAuthStore.getState().restoreSession(true);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // The SDK refreshes the access token on its own; when that refresh fails —
    // the refresh token was revoked, rotated out, or aged past its lifetime —
    // it signs the client out and fires SIGNED_OUT. Without this the app kept
    // rendering cached screens against a dead session until some read happened
    // to fail, so a user could sit on a stale dashboard indefinitely. Watching
    // the event drops them on the login screen the moment the session dies.
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') void useAuthStore.getState().expireSession();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // Supabase isn't configured in this environment — nothing to watch.
    }
    return () => unsubscribe?.();
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
