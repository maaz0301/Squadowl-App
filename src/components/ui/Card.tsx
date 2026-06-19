import { cn } from '@/lib/cn';
import { View, type ViewProps } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface CardProps extends ViewProps {
  className?: string;
  accent?: boolean;
  glass?: boolean;
}

export function Card({ children, className, accent, glass, style, ...props }: CardProps) {
  const colors = useThemeColors();
  return (
    <View
      className={cn('rounded-lg p-4 border', className)}
      style={[
        {
          backgroundColor: glass ? colors.cardGlass : colors.card,
          borderColor: colors.border,
          borderLeftWidth: accent ? 3 : 1,
          borderLeftColor: accent ? colors.primary : colors.border,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}
