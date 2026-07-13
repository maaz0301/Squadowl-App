import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, Screen, ThemeToggle } from '@/components/ui';
import { APP_CONFIG } from '@/config/app';

export default function LoginScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await login(data.email, data.password);
      // RootNavigator will automatically unmount AuthNavigator and show AppNavigator
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll className="justify-center relative">
      <View className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </View>
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
        <View>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value }, fieldState: { error: fe } }) => (
              <Input
                label="Password"
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
        <Button label="Sign In" onPress={onSubmit} loading={loading} />
        
        <View className="flex-row justify-center py-2">
          <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
            <Text className="font-bold" style={{ color: colors.primary }}>
              Forgot Password?
            </Text>
          </Pressable>
        </View>

        <View className="flex-row justify-center gap-1 py-2">
          <Text style={{ color: colors.inkMuted }}>New coach?</Text>
          <Pressable onPress={() => navigation.navigate('Signup')}>
            <Text className="font-bold" style={{ color: colors.primary }}>
              Create account
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
