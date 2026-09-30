import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

interface TypeToConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  /** The word the user has to type (case-insensitive) before the button enables. */
  word?: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for deletes that can't be undone: the button stays off until the word is typed. */
export function TypeToConfirmModal({
  visible,
  title,
  message,
  word = 'delete',
  confirmLabel = 'Delete',
  loading,
  onConfirm,
  onCancel,
}: TypeToConfirmModalProps) {
  const colors = useThemeColors();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (visible) setTyped('');
  }, [visible]);

  const matches = typed.trim().toLowerCase() === word.toLowerCase();

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={onCancel}
      footer={
        <View className="flex-row gap-2 mt-4">
          <Button label="Cancel" variant="ghost" className="flex-1" onPress={onCancel} />
          <Button
            label={confirmLabel}
            variant="danger"
            className="flex-1"
            disabled={!matches}
            loading={loading}
            onPress={onConfirm}
          />
        </View>
      }
    >
      <View className="gap-3">
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {message}
        </Text>
        <Input
          label={`Type "${word}" to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={word}
        />
      </View>
    </Modal>
  );
}
