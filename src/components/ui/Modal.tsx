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
}

export function Modal({ visible, title, onClose, children, footer }: ModalProps) {
  const colors = useThemeColors();
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.overlay }}
      >
        <Pressable className="flex-1" onPress={onClose} />
        <View
          className="rounded-t-xl border-t px-5 pt-5 pb-8 max-h-[90%]"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
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
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
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
