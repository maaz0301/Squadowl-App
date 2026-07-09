import messaging from '@react-native-firebase/messaging';
import { getSupabase } from './supabase';

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
        const token = await messaging().getToken();
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
      const { error } = await supabase
        .from('fcm_tokens')
        .upsert(
          { user_id: userId, token },
          { onConflict: 'user_id,token' }
        );

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
      const token = await messaging().getToken();
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

      const token = await messaging().getToken();
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
