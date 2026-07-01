import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Screen } from '@/components/ui';
import { PLAN_DEFINITIONS } from '@/data/plans';
import { useUser } from '@/state/authStore';
import { useUpdateProfileMutation } from '@/features/queries';

export default function UpgradeScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const updateProfile = useUpdateProfileMutation();

  const upgrade = async (tier: typeof PLAN_DEFINITIONS[number]['tier']) => {
    await updateProfile.mutateAsync({ planTier: tier });
    navigation.goBack();
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Upgrade Plan" subtitle={`Current: ${user?.planTier ?? 'free'}`} showBack />
      </View>
      <FlatList
        data={PLAN_DEFINITIONS}
        keyExtractor={(p) => p.tier}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        renderItem={({ item }) => {
          const isCurrent = user?.planTier === item.tier;
          return (
            <Card accent={item.highlight} className="mb-4 gap-3">
              <View className="flex-row justify-between items-start">
                <View>
                  <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
                    {item.name}
                  </Text>
                  <Text className="text-2xl font-display font-bold" style={{ color: colors.primary }}>
                    {item.price}
                    <Text className="text-sm" style={{ color: colors.inkMuted }}> {item.priceNote}</Text>
                  </Text>
                </View>
                {isCurrent ? <Badge label="Current" variant="brand" /> : null}
                {item.highlight ? <Badge label="Popular" variant="success" /> : null}
              </View>
              {item.features.map((f) => (
                <View key={f.label} className="flex-row gap-2">
                  <Text style={{ color: f.included ? colors.success : colors.inkFaint }}>
                    {f.included ? '✓' : '○'}
                  </Text>
                  <Text style={{ color: f.included ? colors.ink : colors.inkMuted }}>{f.label}</Text>
                </View>
              ))}
              {!isCurrent ? (
                <Button
                  label={`Switch to ${item.name}`}
                  variant={item.highlight ? 'primary' : 'secondary'}
                  onPress={() => upgrade(item.tier)}
                  loading={updateProfile.isPending}
                />
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
