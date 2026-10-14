import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { APP_CONFIG } from '@/config/app';
import { getSupabase } from '@/lib/supabase';
import { isBelowMinimum } from '@/lib/versionPolicy';
import pkg from '../../package.json';

/** This build's version, from package.json. Bump it with each release so the founder's minimum can target it. */
export const APP_VERSION: string = pkg.version;

const STORE_URL =
  Platform.OS === 'android' ? 'https://play.google.com/store/apps/details?id=com.aastryout' : APP_CONFIG.webUrl;

/**
 * Blocks the app behind an "Update required" screen when this build is older
 * than the minimum version the founder set (Founder Console, Announcements).
 * Checked on launch and each time the app returns to the foreground. A failed
 * check never blocks anyone.
 */
export function UpdateRequiredGate({ children }: { children: ReactNode }) {
  const [policy, setPolicy] = useState<{ minVersion?: string | null; message?: string | null }>({});

  const check = useCallback(async () => {
    try {
      const { data, error } = await getSupabase().rpc('app_version_policy');
      if (!error && data) setPolicy(data as { minVersion?: string | null; message?: string | null });
    } catch {
      // Offline or not configured: carry on.
    }
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => sub.remove();
  }, [check]);

  const blocked = isBelowMinimum(APP_VERSION, policy.minVersion);
  return (
    <>
      {children}
      <Modal visible={blocked} animationType="fade" onRequestClose={() => undefined}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0b0b10' }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 }}>Update required</Text>
          <Text style={{ color: '#cbd0dc', fontSize: 15, textAlign: 'center', marginBottom: 24 }}>
            {policy.message || 'A newer version of SquadOwl is available. Please update to keep going.'}
          </Text>
          <Pressable
            onPress={() => Linking.openURL(STORE_URL)}
            style={{ backgroundColor: '#f97316', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Update</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
