import { useEffect, useState } from 'react';
import {
  Keyboard,
  Modal as RNModal,
  Pressable,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';

interface ModalProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  // Set to false when children manage their own scrolling (e.g. a FlatList),
  // so a long list can virtualize instead of mounting every row at once —
  // nesting a FlatList inside this Modal's own ScrollView would otherwise
  // disable its virtualization entirely.
  scroll?: boolean;
}

/**
 * How far the keyboard covers the bottom of the sheet, on Android.
 *
 * A Modal is its own window, and on Android whether that window shrinks when the
 * keyboard opens depends on the OS version and the app's edge-to-edge mode.
 * KeyboardAvoidingView guesses from its own frame and often guesses wrong there
 * — the keyboard sat on top of the text being typed, with no way to scroll it
 * clear. So this measures instead: where the keyboard starts, against where the
 * window ends. If the OS already shrank the window there is no overlap and
 * nothing is added; if it didn't, the sheet is lifted by exactly the overlap.
 * Derived at render from both numbers, so a late layout can't leave a stale
 * lift behind. iOS keeps KeyboardAvoidingView.
 */
function useKeyboardOverlap(visible: boolean, windowHeight: number): number {
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardTop(e.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => {
      show.remove();
      hide.remove();
      setKeyboardTop(null);
    };
  }, [visible]);

  if (Platform.OS !== 'android' || keyboardTop === null || windowHeight === 0) return 0;
  return Math.max(0, Math.round(windowHeight - keyboardTop));
}

export function Modal({ visible, title, onClose, children, footer, scroll = true }: ModalProps) {
  const colors = useThemeColors();
  const [windowHeight, setWindowHeight] = useState(0);
  const overlap = useKeyboardOverlap(visible, windowHeight);
  // Once lifted, the sheet has to fit in what is left above the keyboard, or its
  // top runs off the screen; the ScrollView inside takes the difference.
  const liftedMaxHeight = overlap > 0 ? Math.max(200, windowHeight - overlap - 24) : undefined;
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      // Window and screen coordinates line up only when the window starts at
      // the very top; the overlap measurement above depends on it.
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS === 'ios'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.overlay }}
        onLayout={(e) => setWindowHeight(Math.round(e.nativeEvent.layout.height))}
      >
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className={`rounded-t-xl border-t px-5 pt-5 pb-8 ${scroll ? 'max-h-[90%]' : ''}`}
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            ...(scroll ? null : { height: '85%' }),
            ...(overlap > 0 ? { marginBottom: overlap, ...(scroll ? { maxHeight: liftedMaxHeight } : { height: liftedMaxHeight }) } : null),
          }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-xl font-display font-bold flex-1" style={{ color: colors.ink }}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text className="text-2xl" style={{ color: colors.inkMuted }}>
                ×
              </Text>
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
              // flexShrink is 0 by default, so tall content would push past the
              // sheet's max height and get clipped by the screen edge instead of
              // scrolling within it. Shrinking lets the sheet cap its own height
              // and hand the overflow to this scroll view.
              style={{ flexShrink: 1 }}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>{children}</View>
          )}
          {footer ?? (
            <View className="mt-4">
              <Button label="Close" variant="secondary" onPress={onClose} />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}
