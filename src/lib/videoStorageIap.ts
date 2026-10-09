import { Platform } from 'react-native';
import type { VideoStorageGb } from '@/data/videoStorage';

/**
 * Native in-app purchase for the Video Storage Add-On (Apple IAP on iOS, Google
 * Play Billing on Android). NOT WIRED UP YET.
 *
 * What exists today is the Stripe route: the Storage screen opens the same
 * Stripe checkout the web uses, and the webhook switches storage on. What is
 * needed before flipping NATIVE_VIDEO_STORAGE_IAP_ENABLED:
 *
 *   1. A purchase library with its native module (for example react-native-iap or
 *      RevenueCat), added and rebuilt for both platforms.
 *   2. The three yearly subscription products created in App Store Connect and
 *      Play Console, at the prices below (same as web), under the ids in
 *      VIDEO_STORAGE_IAP_PRODUCT_IDS (change them to match what you create).
 *   3. Server-side receipt validation that calls set_video_storage() with
 *      source 'apple' or 'google' (App Store Server Notifications, Google RTDN),
 *      the way stripe-webhook does for Stripe. The database already accepts both
 *      sources and the maintenance function treats all sources alike.
 *
 * Apple requires in-app purchase for digital goods sold inside an iOS app, so the
 * Stripe route should be switched off on iOS once step 1 to 3 are done.
 */
export const NATIVE_VIDEO_STORAGE_IAP_ENABLED = false;

export const VIDEO_STORAGE_IAP_PRODUCT_IDS: Record<VideoStorageGb, string> = {
  1: 'squadowl.videostorage.1gb.yearly',
  5: 'squadowl.videostorage.5gb.yearly',
  20: 'squadowl.videostorage.20gb.yearly',
};

/** Whether the store's own purchase sheet should be used on this device. */
export function useNativeVideoStoragePurchase(): boolean {
  return NATIVE_VIDEO_STORAGE_IAP_ENABLED && (Platform.OS === 'ios' || Platform.OS === 'android');
}

export async function purchaseVideoStorageNative(_gb: VideoStorageGb): Promise<void> {
  throw new Error('Buying storage in the app store is not set up yet.');
}

/** Where a store-billed subscription is managed. */
export function storeSubscriptionsUrl(source: 'apple' | 'google'): string {
  return source === 'apple'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}
