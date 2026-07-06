import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignupFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, Screen, Header } from '@/components/ui';

export default function SignupScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const signup = useAuthStore((s) => s.signup);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(SignupFormSchema),
    defaultValues: { displayName: '', email: '', password: '', accountType: 'coach' as const },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await signup(data.displayName, data.email, data.password, data.accountType);
      navigation.replace('Welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <Header title="Create Account" showBack />
      <View className="gap-4 mt-4">
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
            <Input label="Password" secureTextEntry onBlur={onBlur} onChangeText={onChange} value={value} error={fe?.message} />
          )}
        />
        <Controller
          control={control}
          name="accountType"
          render={({ field: { onChange, value } }) => (
            <View className="gap-2 mt-2 mb-2">
              <Text className="text-sm font-bold" style={{ color: colors.ink }}>Account Type</Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => onChange('coach')}
                  className="flex-1 py-3 items-center rounded-md border"
                  style={{ 
                    borderColor: value === 'coach' ? colors.primary : colors.border,
                    backgroundColor: value === 'coach' ? colors.primary + '15' : colors.tile
                  }}
                >
                  <Text className="font-bold" style={{ color: value === 'coach' ? colors.primary : colors.ink }}>Coach / Assessor</Text>
                </Pressable>
                <Pressable
                  onPress={() => onChange('guardian')}
                  className="flex-1 py-3 items-center rounded-md border"
                  style={{ 
                    borderColor: value === 'guardian' ? colors.primary : colors.border,
                    backgroundColor: value === 'guardian' ? colors.primary + '15' : colors.tile
                  }}
                >
                  <Text className="font-bold" style={{ color: value === 'guardian' ? colors.primary : colors.ink }}>Guardian</Text>
                </Pressable>
              </View>
            </View>
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
