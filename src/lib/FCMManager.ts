import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { getSupabase } from './supabase';

/**
 * The device token, or null when this device can't receive pushes (an iOS
 * simulator, or a build without the aps-environment entitlement). That is an
 * expected state, not a failure, so it logs a warning rather than an error —
 * errors surface as a red toast in dev builds. Anything else still throws.
 */
async function getDeviceToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') {
      // Required before getToken() on iOS; a no-op if already registered.
      await messaging().registerDeviceForRemoteMessages();
    }
    return await messaging().getToken();
  } catch (error: any) {
    // `unregistered`: no APNs registration. `unknown` + aps-environment: the build
    // lacks the push entitlement (unsigned simulator builds). Both mean "no push here".
    const msg = String(error?.message ?? '');
    if (error?.code === 'messaging/unregistered' || msg.includes('aps-environment')) {
      console.warn('FCM: push notifications are unavailable on this device/build.');
      return null;
    }
    throw error;
  }
}

export class FCMManager {
  private static isInitialized = false;

  static async initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      // Request permissions
      await this.requestUserPermission();

      // Listen to token refresh
      messaging().onTokenRefresh(async (token) => {
        console.log('FCM Token refreshed:', token);
        await this.saveTokenToSupabase(token);
      });
    } catch (error) {
      console.error('Error during FCMManager initialization:', error);
    }
  }

  private static async requestUserPermission() {
    try {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('FCM Authorization status:', authStatus);
        const token = await getDeviceToken();
        if (token) {
          await this.saveTokenToSupabase(token);
        }
      }
    } catch (error) {
      console.error('Error requesting FCM permissions/getting token:', error);
    }
  }

  private static async saveTokenToSupabase(token: string) {
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        console.log('FCM: No active session user. Token will be saved when user logs in.');
        return;
      }

      console.log(`FCM: Registering token for user ${userId}`);
      // Claim the token for this account only: the phone may have been signed in
      // as someone else before, and their copy must stop receiving pushes meant
      // for them on this phone (and stop doubling up ours).
      let { error } = await supabase.rpc('claim_fcm_token', { p_token: token });
      if (error) {
        // Older database without the function: fall back to adding the token.
        ({ error } = await supabase
          .from('fcm_tokens')
          .upsert({ user_id: userId, token }, { onConflict: 'user_id,token' }));
      }

      if (error) {
        console.error('Error saving FCM token to Supabase:', error);
      } else {
        console.log('FCM token successfully registered to database.');
      }
    } catch (error) {
      console.error('Error in saveTokenToSupabase:', error);
    }
  }

  static async login(userId: string) {
    try {
      console.log(`FCM: Logging in user ${userId}`);
      const token = await getDeviceToken();
      if (token) {
        await this.saveTokenToSupabase(token);
      }
    } catch (error) {
      console.error('Error in FCMManager.login:', error);
    }
  }

  static async logout() {
    try {
      console.log('FCM: Logging out user');
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      const token = await getDeviceToken();
      if (token) {
        if (userId) {
          console.log(`FCM: Removing token registration for user ${userId}`);
          const { error } = await supabase
            .from('fcm_tokens')
            .delete()
            .eq('user_id', userId)
            .eq('token', token);
          if (error) {
            console.error('Error deleting FCM token record:', error);
          }
        } else {
          console.log('FCM: Removing token registration');
          const { error } = await supabase
            .from('fcm_tokens')
            .delete()
            .eq('token', token);
          if (error) {
            console.error('Error deleting FCM token record:', error);
          }
        }
      }
    } catch (error) {
      console.error('Error in FCMManager.logout:', error);
    }
  }
}
