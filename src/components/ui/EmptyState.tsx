import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center p-8 gap-3">
      <Text className="text-xl font-display font-bold text-center" style={{ color: colors.ink }}>
        {title}
      </Text>
      {message ? (
        <Text className="text-base text-center" style={{ color: colors.inkMuted }}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}
