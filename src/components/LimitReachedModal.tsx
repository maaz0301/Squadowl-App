import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Modal, Button } from '@/components/ui';

interface Props {
  visible: boolean;
  onClose: () => void;
  message: string;
}

export function LimitReachedModal({ visible, onClose, message }: Props) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();

  return (
    <Modal
      visible={visible}
      title="Plan Limit Reached"
      onClose={onClose}
      footer={
        <View className="flex-row gap-2 w-full">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" onPress={onClose} />
          </View>
          <View className="flex-1">
            <Button label="View Plans" onPress={() => { onClose(); navigation.navigate('Upgrade'); }} />
          </View>
        </View>
      }
    >
      <View className="py-4">
        <Text className="text-base text-center" style={{ color: colors.ink }}>
          {message}
        </Text>
      </View>
    </Modal>
  );
}
