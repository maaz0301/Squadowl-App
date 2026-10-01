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
  /** The word the user has to type, exactly as written (case-sensitive), before the button enables. */
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
  word = 'DELETE',
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

  const matches = typed.trim() === word;

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
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={word}
        />
      </View>
    </Modal>
  );
}

export interface TypeToConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/**
 * Imperative wrapper for TypeToConfirmModal: call `ask({...})` from a delete button and render
 * `modal` once in the screen. Replaces Alert.alert / window.confirm for deletes, which also never
 * showed on react-native-web.
 */
export function useTypeToConfirm() {
  const [request, setRequest] = useState<TypeToConfirmRequest | null>(null);

  const modal = (
    <TypeToConfirmModal
      visible={request !== null}
      title={request?.title ?? ''}
      message={request?.message ?? ''}
      confirmLabel={request?.confirmLabel}
      onCancel={() => setRequest(null)}
      onConfirm={() => {
        const run = request?.onConfirm;
        setRequest(null);
        run?.();
      }}
    />
  );

  return { ask: setRequest, modal };
}
