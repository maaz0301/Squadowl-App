import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useAuthStore, useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Header, Screen, ThemeToggle } from '@/components/ui';

/**
 * Replaces the whole app for a member whose organization is suspended — same
 * role as web's SuspendedAccountScreen (src/components/AccountAccessNotices.tsx
 * in the web repo). RLS has already cut the account's data off; this just says
 * so instead of leaving every screen to fail with no explanation.
 */
export default function SuspendedAccountScreen() {
  const colors = useThemeColors();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const [signingOut, setSigningOut] = useState(false);
  const trialEnded = !!user?.trialExpired;

  return (
    <Screen scroll>
      <Header title={trialEnded ? 'Trial Ended' : 'Account Suspended'} right={<ThemeToggle />} />
      <View className="gap-5 mt-6">
        <Card accent className="gap-3 p-4">
          <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
            {trialEnded ? 'Your trial has ended' : 'Your organization is suspended'}
          </Text>
          <Text className="text-base" style={{ color: colors.inkMuted }}>
            {user?.organization ? `${user.organization} ` : 'This account '}
            {trialEnded
              ? 'no longer has access. Your teams and evaluations are safe, contact SquadOwl to continue.'
              : 'has been suspended. Your data has not been deleted, contact SquadOwl to restore access.'}
          </Text>
          {user?.suspendedReason ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Reason: {user.suspendedReason}
            </Text>
          ) : null}
        </Card>

        <View className="gap-3">
          <Button label="Email founder@tryout.ca" onPress={() => Linking.openURL('mailto:founder@tryout.ca')} />
          <Button
            label="Sign Out"
            variant="ghost"
            loading={signingOut}
            onPress={async () => {
              if (signingOut) return;
              setSigningOut(true);
              try {
                await logout();
              } finally {
                setSigningOut(false);
              }
            }}
          />
        </View>
      </View>
    </Screen>
  );
}
