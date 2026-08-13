import {
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

export function Modal({ visible, title, onClose, children, footer, scroll = true }: ModalProps) {
  const colors = useThemeColors();
  return (
    <RNModal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.overlay }}
      >
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className={`rounded-t-xl border-t px-5 pt-5 pb-8 ${scroll ? 'max-h-[90%]' : ''}`}
          style={{ backgroundColor: colors.card, borderColor: colors.border, ...(scroll ? null : { height: '85%' }) }}
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
