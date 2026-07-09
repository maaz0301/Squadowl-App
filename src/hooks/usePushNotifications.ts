import { useEffect } from 'react';
import { FCMManager } from '../lib/FCMManager';
import { useAuthStore } from '../state/authStore';

export function usePushNotifications() {
  const { session } = useAuthStore();

  useEffect(() => {
    FCMManager.initialize();
  }, []);

  // Sync user ID with FCM when they log in
  useEffect(() => {
    if (session?.user?.id) {
      FCMManager.login(session.user.id);
    } else {
      FCMManager.logout();
    }
  }, [session?.user?.id]);
}
