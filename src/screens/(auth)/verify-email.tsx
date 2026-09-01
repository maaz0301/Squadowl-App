import { useState } from 'react';
import { Text, View, Alert } from 'react-native';
import { useAuthStore, useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Header, Screen, ThemeToggle } from '@/components/ui';

export default function VerifyEmailScreen() {
  const colors = useThemeColors();
  const user = useUser();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const resendVerificationEmail = useAuthStore((s) => s.resendVerificationEmail);
  const logout = useAuthStore((s) => s.logout);

  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusMsg(null);
    try {
      await restoreSession(true);
      const currentUser = useAuthStore.getState().session?.user;
      if (currentUser?.emailVerified) {
        Alert.alert('Verified!', 'Your email has been verified. Welcome to TryoutHQ!');
      } else {
        setStatusMsg('Email is not verified yet. Please check your inbox and tap the link.');
      }
    } catch (e: any) {
      setStatusMsg(e?.message || 'Could not verify status.');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (!user?.email) return;
    setResending(true);
    setStatusMsg(null);
    try {
      await resendVerificationEmail(user.email);
      Alert.alert('Email Sent', `A new verification email was sent to ${user.email}.`);
    } catch (e: any) {
      Alert.alert('Resend Failed', e?.message || 'Failed to resend verification email.');
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="Verify Email" right={<ThemeToggle />} />
      <View className="gap-5 mt-6">
        <View className="gap-2">
          <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
            Verify your email address
          </Text>
          <Text className="text-base" style={{ color: colors.inkMuted }}>
            We need to confirm you own this email address before granting full access to your account.
          </Text>
        </View>

        <Card accent className="gap-2 p-4">
          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Target Email
          </Text>
          <Text className="text-lg font-bold" style={{ color: colors.primary }}>
            {user?.email ?? 'Your registered email'}
          </Text>
        </Card>

        {statusMsg ? (
          <Text className="text-sm text-center" style={{ color: colors.warning }}>
            {statusMsg}
          </Text>
        ) : null}

        <View className="gap-3 mt-2">
          <Button
            label="I've Verified — Continue to App"
            onPress={handleCheckStatus}
            loading={checking}
          />
          <Button
            label="Resend Verification Email"
            variant="secondary"
            onPress={handleResend}
            loading={resending}
          />
          <Button
            label="Sign Out / Back to Login"
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
