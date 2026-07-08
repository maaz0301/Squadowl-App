import { useEffect } from 'react';
import { OneSignalManager } from '../lib/OneSignalManager';
import { useAuthStore } from '../state/authStore';

export function usePushNotifications() {
  const { session } = useAuthStore();

  useEffect(() => {
    OneSignalManager.initialize();
  }, []);

  // Sync user ID with OneSignal when they log in
  useEffect(() => {
    if (session?.user?.id) {
      OneSignalManager.login(session.user.id);
    } else {
      OneSignalManager.logout();
    }
  }, [session?.user?.id]);
}
