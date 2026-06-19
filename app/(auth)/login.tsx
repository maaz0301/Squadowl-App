import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, Screen } from '@/components/ui';
import { APP_CONFIG } from '@/config/app';

export default function LoginScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: 'coach@example.com', password: 'password123' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await login(data.email, data.password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll className="justify-center">
      <View className="gap-2 mb-8">
        <Text className="text-display font-display font-bold" style={{ color: colors.primary }}>
          {APP_CONFIG.appName}
        </Text>
        <Text className="text-lg" style={{ color: colors.inkMuted }}>
          Coach login — run tryouts from the sideline
        </Text>
      </View>

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
              secureTextEntry
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
        <View className="flex-row justify-center gap-1 py-2">
          <Text style={{ color: colors.inkMuted }}>New coach?</Text>
          <Link href="/(auth)/signup" asChild>
            <Pressable>
              <Text className="font-bold" style={{ color: colors.primary }}>
                Create account
              </Text>
            </Pressable>
          </Link>
        </View>
        <Text className="text-xs text-center" style={{ color: colors.inkFaint }}>
          Demo: coach@example.com / password123
        </Text>
      </View>
    </Screen>
  );
}
