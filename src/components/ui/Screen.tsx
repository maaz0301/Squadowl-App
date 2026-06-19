import { SafeAreaView, ScrollView, View, type ViewProps } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { cn } from '@/lib/cn';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Screen({ scroll, padded = true, className, children, ...props }: ScreenProps) {
  const colors = useThemeColors();
  const content = (
    <View className={cn('flex-1', padded && 'px-4', className)} {...props}>
      {children}
    </View>
  );

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.bg }}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}
