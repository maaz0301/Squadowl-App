import { LogLevel, OneSignal } from 'react-native-onesignal';
import { Alert } from 'react-native';
import { storage } from './storage';

const ONESIGNAL_APP_ID = 'beb9847d-df0b-407b-af5f-b637950ab7fb';
const ONESIGNAL_SHOWN_ONCE_KEY = 'onesignal_verification_shown';

export class OneSignalManager {
  private static isInitialized = false;

  static async initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    OneSignal.Debug.setLogLevel(LogLevel.Verbose);
    OneSignal.initialize(ONESIGNAL_APP_ID);

    this.setupSubscriptionObserver();
    this.setupNotificationClickListener();
  }

  private static setupNotificationClickListener() {
    OneSignal.Notifications.addEventListener('click', async (event) => {
      const launchURL = event.notification.launchURL;
      
      if (launchURL) {
        try {
          const { InAppBrowser } = require('react-native-inappbrowser-reborn');
          const { Linking } = require('react-native');
          
          if (await InAppBrowser.isAvailable()) {
            await InAppBrowser.open(launchURL, {
              // iOS Properties
              dismissButtonStyle: 'cancel',
              preferredBarTintColor: '#000000',
              preferredControlTintColor: 'white',
              readerMode: false,
              animated: true,
              modalPresentationStyle: 'fullScreen',
              modalTransitionStyle: 'coverVertical',
              modalEnabled: true,
              enableBarCollapsing: false,
              // Android Properties
              showTitle: true,
              toolbarColor: '#000000',
              secondaryToolbarColor: 'black',
              navigationBarColor: 'black',
              navigationBarDividerColor: 'white',
              enableUrlBarHiding: true,
              enableDefaultShare: true,
              forceCloseOnRedirection: false,
              animations: {
                startEnter: 'slide_in_right',
                startExit: 'slide_out_left',
                endEnter: 'slide_in_left',
                endExit: 'slide_out_right'
              },
            });
          } else {
            Linking.openURL(launchURL);
          }
        } catch (error) {
          console.error('Error opening launch URL:', error);
        }
      }
    });
  }

  private static setupSubscriptionObserver() {
    // Evaluate the current subscription ID immediately
    this.checkSubscriptionAndShowDialog(OneSignal.User.pushSubscription.getPushSubscriptionId());

    // Register a push subscription observer
    OneSignal.User.pushSubscription.addEventListener('change', (event) => {
      this.checkSubscriptionAndShowDialog(event.current.id);
    });
  }

  private static checkSubscriptionAndShowDialog(subscriptionId: string | undefined | null) {
    if (!subscriptionId || subscriptionId.startsWith('local-')) {
      return;
    }

    const hasShown = storage.getBoolean(ONESIGNAL_SHOWN_ONCE_KEY);
    if (!hasShown) {
      storage.set(ONESIGNAL_SHOWN_ONCE_KEY, true);
      
      Alert.alert(
        'Your OneSignal SDK integration is complete!',
        'You can now send Push Notifications & In-App Messages through OneSignal. Tap below to enable push notifications.',
        [
          {
            text: 'Got it',
            onPress: () => {
              OneSignal.Notifications.requestPermission(true);
            },
          },
        ],
        { cancelable: false }
      );
    }
  }

  static login(userId: string) {
    OneSignal.login(userId);
  }

  static logout() {
    OneSignal.logout();
  }
}
