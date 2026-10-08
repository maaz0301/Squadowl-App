import { useEffect, useState } from 'react';
import { Text, View, Pressable, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Input, Screen, ThemeToggle } from '@/components/ui';
import { LegalLinks } from '@/components/LegalLinks';
import { APP_CONFIG } from '@/config/app';

export default function LoginScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const login = useAuthStore((s) => s.login);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const clearSessionExpired = useAuthStore((s) => s.clearSessionExpired);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => clearSessionExpired();
  }, [clearSessionExpired]);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await login(data.email.trim(), data.password);
    } catch (e: any) {
      console.warn('Login failed:', e);
      setError(e?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll className="justify-center relative">
      <View className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </View>
      
      {/* Brand Hero Banner */}
      <View className="items-center mb-6 pt-6">
        <Image
          source={
            isDark
              ? require('../../../assets/SquadOwl-full-logo-dark.png')
              : require('../../../assets/SquadOwl-full-logo-light.png')
          }
          style={{ width: '100%', height: 200, resizeMode: 'contain' }}
        />
        <Text className="text-base text-center mt-2 font-medium" style={{ color: colors.inkMuted }}>
          Sign in to manage tryouts and evaluate players
        </Text>
      </View>

      {sessionExpired ? (
        <View
          className="mb-4 rounded-xl px-4 py-3 border"
          style={{ backgroundColor: colors.tile, borderColor: colors.warning }}
        >
          <Text className="text-sm font-medium" style={{ color: colors.warning }}>
            Your session has expired. Please sign in again.
          </Text>
        </View>
      ) : null}

      <View className="gap-4">
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

        {error ? (
          <Text className="text-sm" style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        <Button label="Sign In" onPress={onSubmit} loading={loading} />
        
        <View className="flex-row justify-center py-2">
          <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
            <Text className="font-bold" style={{ color: colors.primary }}>
              Forgot Password?
            </Text>
          </Pressable>
        </View>

        <View className="flex-row justify-center gap-1 py-2">
          <Text style={{ color: colors.inkMuted }}>Don't have an account?</Text>
          <Pressable onPress={() => navigation.navigate('Signup')}>
            <Text className="font-bold" style={{ color: colors.primary }}>
              Create account
            </Text>
          </Pressable>
        </View>

        <LegalLinks prefix />
      </View>
    </Screen>
  );
}
