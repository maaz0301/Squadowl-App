import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useThemeColors } from '@/theme/ThemeProvider';
import { cn } from '@/lib/cn';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  padded?: boolean;
  className?: string;
  /** Safe-area edges to apply. Omit 'top' on screens that sit under a native header. */
  edges?: Edge[];
  /** Enable keyboard avoiding view for forms (defaults to true) */
  keyboardAvoiding?: boolean;
  /** Custom vertical offset for KeyboardAvoidingView */
  keyboardOffset?: number;
  children: React.ReactNode;
}

export function Screen({
  scroll,
  padded = true,
  className,
  edges = ['top', 'left', 'right'],
  keyboardAvoiding = true,
  keyboardOffset = Platform.OS === 'ios' ? 88 : 0,
  children,
  ...props
}: ScreenProps) {
  const colors = useThemeColors();

  const innerContent = (
    <View className={cn('flex-1', padded && 'px-4', className)} {...props}>
      {children}
    </View>
  );

  const mainView = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {innerContent}
    </ScrollView>
  ) : (
    innerContent
  );

  return (
    <SafeAreaView className="flex-1" edges={edges} style={{ backgroundColor: colors.bg }}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardOffset}
        >
          {mainView}
        </KeyboardAvoidingView>
      ) : (
        mainView
      )}
    </SafeAreaView>
  );
}
