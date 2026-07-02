import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

import { Screen } from './Screen';

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  const colors = useThemeColors();
  return (
    <Screen padded={false}>
      <View className="flex-1 items-center justify-center p-8 gap-3">
        <Text className="text-xl font-display font-bold text-center" style={{ color: colors.danger }}>
          {title}
        </Text>
        <Text className="text-base text-center" style={{ color: colors.inkMuted }}>
          {message}
        </Text>
        {onRetry ? <Button label="Try Again" onPress={onRetry} variant="secondary" /> : null}
      </View>
    </Screen>
  );
}
