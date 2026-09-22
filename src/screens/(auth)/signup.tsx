import { useState } from 'react';
import { Text, View, Pressable, Image } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignupFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Screen, Header, ThemeToggle } from '@/components/ui';
import { flushPendingReferralCode, savePendingReferralCode } from '@/lib/pendingReferral';

export default function SignupScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const signup = useAuthStore((s) => s.signup);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Arrives via the aastryout://signup?ref=CODE deep link a referrer shares —
  // see the loyalty "Share My Code" flow. Only ever prefills the field; the
  // person can still clear or overwrite it before submitting.
  const referredCode: string = (route.params?.ref ?? '').toString().toUpperCase();

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(SignupFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      accountType: 'coach' as const,
      referralCode: referredCode,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    // Stored BEFORE signup runs, not after. This project has e-mail
    // confirmation on, so signup() comes back with no session and throws
    // "confirm your email, then log in" — nothing after that call executes, so
    // applying the code here would drop it for every user who has to verify.
    // Persisted, it survives to the first real session (see authStore).
    const code = data.referralCode?.trim();
    if (code) savePendingReferralCode(code);
    try {
      await signup(data.displayName, data.email, data.password, data.accountType);
      // Reached only when signup handed back a usable session; otherwise the
      // login that follows e-mail verification flushes it instead.
      await flushPendingReferralCode();
      navigation.replace('Welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <Header title="Create Account" showBack right={<ThemeToggle />} />
      
      {/* Brand Hero Banner */}
      <View className="items-center my-4">
        <Image
          source={
            isDark
              ? require('../../../assets/TryoutHQ--full-logo.png')
              : require('../../../assets/TryoutHQ-logo-light-full.png')
          }
          style={{ width: '100%', height: 90, resizeMode: 'contain' }}
        />
      </View>

      <View className="gap-4 mt-2">
        <Controller
          control={control}
          name="displayName"
          render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
            <Input label="Your Name" onBlur={onBlur} onChangeText={onChange} value={value} error={fe?.message} />
          )}
        />
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
            <Input
              label="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              error={fe?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
            <Input
              label="Password"
              isPassword
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              error={fe?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="confirmPassword"
          render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
            <Input
              label="Confirm Password"
              isPassword
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              error={fe?.message}
            />
          )}
        />

        <Controller
          control={control}
          name="referralCode"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Referral Code (optional)"
              placeholder="e.g. K7M2QX9BD"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
              onBlur={onBlur}
              onChangeText={(t) => onChange(t.toUpperCase())}
              value={value}
            />
          )}
        />

        {error ? (
          <Text className="text-sm" style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        <Button label="Create Account" onPress={onSubmit} loading={loading} />
        <View className="flex-row justify-center gap-1 py-2">
          <Text style={{ color: colors.inkMuted }}>Already have an account?</Text>
          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text className="font-bold" style={{ color: colors.primary }}>
              Sign in
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
