import { ActivityIndicator, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { APP_CONFIG } from '@/config/app';

export function SplashScreen() {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center gap-6" style={{ backgroundColor: colors.bg }}>
      <Text className="text-4xl font-display font-bold" style={{ color: colors.primary }}>
        {APP_CONFIG.appName}
      </Text>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
