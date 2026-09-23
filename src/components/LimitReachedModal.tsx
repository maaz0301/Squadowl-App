import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Modal, Button } from '@/components/ui';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';

interface Props {
  visible: boolean;
  onClose: () => void;
  message: string;
}

export function LimitReachedModal({ visible, onClose, message }: Props) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

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
          {!billingBlocked ? (
            <View className="flex-1">
              <Button label="View Plans" onPress={() => { onClose(); navigation.navigate('Upgrade'); }} />
            </View>
          ) : null}
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
