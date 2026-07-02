import { ActivityIndicator, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface LoadingStateProps {
  message?: string;
}

import { Screen } from './Screen';

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  const colors = useThemeColors();
  return (
    <Screen padded={false}>
      <View className="flex-1 items-center justify-center p-8 gap-3">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-base" style={{ color: colors.inkMuted }}>
          {message}
        </Text>
      </View>
    </Screen>
  );
}
