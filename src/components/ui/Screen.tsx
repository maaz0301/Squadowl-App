import { Platform, View, type ViewProps, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
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
  /**
   * Only true for screens actually rendered inside AssessmentTabNavigator's
   * native bottom tab bar. Setting this on a plain stack screen makes
   * KeyboardAwareScrollView subtract a phantom 49-83pt tab-bar height from
   * its keyboard-clearance calculation, leaving the bottom of the form
   * covered by the keyboard.
   */
  insideTabBar?: boolean;
  /**
   * Overrides the theme background for the whole screen. Used by team-scoped
   * screens to wash the page in the team's brand colour; omit everywhere else
   * so screens keep tracking the light/dark theme.
   */
  backgroundColor?: string;
  children: React.ReactNode;
}

export function Screen({
  scroll,
  padded = true,
  className,
  edges = ['top', 'left', 'right'],
  keyboardAvoiding = true,
  keyboardOffset = Platform.OS === 'ios' ? 88 : 0,
  insideTabBar = false,
  backgroundColor,
  children,
  ...props
}: ScreenProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const bg = backgroundColor ?? colors.bg;

  // The default edges leave out 'bottom', and on Android 15+ the app draws
  // behind the system navigation bar (targetSdk 36 forces edge-to-edge), so the
  // last thing on a scrolling screen — Log Out, Delete Account, a Save button —
  // sat under the 3-button bar with only the fixed 32pt of padding to clear it.
  // Skipped when the screen already applies the bottom edge itself, or sits in a
  // tab bar that clears the inset on its own; iOS keeps its existing padding,
  // and older Android reports a bottom inset of 0 so nothing is added there.
  const scrollBottomInset =
    Platform.OS === 'android' && !insideTabBar && !edges.includes('bottom') ? insets.bottom : 0;

  const innerContent = (
    <View className={cn('flex-1', padded && 'px-4', className)} {...props}>
      {children}
    </View>
  );

  const mainView = scroll ? (
    <KeyboardAwareScrollView
      className="flex-1"
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 + scrollBottomInset }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      enableOnAndroid={true}
      extraScrollHeight={Platform.OS === 'ios' ? 20 : 0}
      viewIsInsideTabBar={insideTabBar}
    >
      {innerContent}
    </KeyboardAwareScrollView>
  ) : (
    innerContent
  );

  return (
    <SafeAreaView className="flex-1" edges={edges} style={{ backgroundColor: bg }}>
      {!scroll && keyboardAvoiding ? (
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
