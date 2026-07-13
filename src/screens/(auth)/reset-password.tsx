import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, Screen, Header } from '@/components/ui';

const ResetPasswordSchema = z.object({
  token: z.string().min(6, 'Please enter the 6-digit code'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const email = route.params?.email || '';
  
  const resetPasswordWithOtp = useAuthStore((s) => s.resetPasswordWithOtp);
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { token: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (!email) {
      setError('Missing email address. Please go back and try again.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resetPasswordWithOtp(email, data.token, data.password);
      // Automatically logs in and switches navigation, so no need to navigate manually
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll className="justify-start">
      <Header
        title="New Password"
        showBack={true}
        onBack={() => navigation.goBack()}
      />
      <View className="flex-1 justify-center px-4">
        <View className="gap-2 mb-8">
          <Text className="text-display font-display font-bold" style={{ color: colors.primary }}>
            Enter Reset Code
          </Text>
          <Text className="text-lg" style={{ color: colors.inkMuted }}>
            Enter the 6-digit code sent to {email} and your new password.
          </Text>
        </View>

        <View className="gap-4">
          <Controller
            control={control}
            name="token"
            render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
              <Input
                label="Reset Code"
                autoCapitalize="none"
                keyboardType="number-pad"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={fe?.message}
              />
            )}
          />
          <View>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
                <Input
                  label="New Password"
                  secureTextEntry={!showPassword}
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value}
                  error={fe?.message}
                />
              )}
            />
            <Pressable 
              onPress={() => setShowPassword(!showPassword)} 
              className="flex-row items-center gap-2 mt-4 ml-1 mb-1"
            >
              <View 
                style={{ 
                  width: 20, 
                  height: 20, 
                  borderWidth: 1, 
                  borderColor: showPassword ? colors.primary : colors.border, 
                  borderRadius: 4, 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  backgroundColor: showPassword ? colors.primary : 'transparent' 
                }}
              >
                {showPassword && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
              </View>
              <Text style={{ color: colors.inkMuted }}>Show password</Text>
            </Pressable>
          </View>
          {error ? (
            <Text className="text-sm" style={{ color: colors.danger }}>
              {error}
            </Text>
          ) : null}
          <Button label="Reset Password" onPress={onSubmit} loading={loading} />
        </View>
      </View>
    </Screen>
  );
}
