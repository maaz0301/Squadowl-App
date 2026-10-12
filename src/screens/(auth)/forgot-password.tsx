import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, Screen, Header } from '@/components/ui';

const ForgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(data.email);
      // Navigate to ResetPassword screen with email
      navigation.navigate('ResetPassword', { email: data.email });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request password reset');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll extraScrollHeight={110} className="justify-start">
      <Header
        title="Forgot Password"
        showBack={true}
        onBack={() => navigation.goBack()}
      />
      <View className="flex-1 justify-center px-4">
        <View className="gap-2 mb-8">
          <Text className="text-display font-display font-bold" style={{ color: colors.primary }}>
            Forgot Password?
          </Text>
          <Text className="text-lg" style={{ color: colors.inkMuted }}>
            Enter your email to receive a password reset code.
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
          {error ? (
            <Text className="text-sm" style={{ color: colors.danger }}>
              {error}
            </Text>
          ) : null}
          <Button label="Send Reset Code" onPress={onSubmit} loading={loading} />
          <View className="flex-row justify-center py-2 mt-4">
            <Pressable onPress={() => navigation.navigate('Login')}>
              <Text className="font-bold" style={{ color: colors.primary }}>
                Back to Login
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}
