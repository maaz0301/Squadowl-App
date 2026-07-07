import { FlatList, Text, View, Alert } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Screen } from '@/components/ui';
import { PLAN_DEFINITIONS } from '@/data/plans';
import { useUser, useAuthStore } from '@/state/authStore';
import { getDataSource } from '@/data';
import { useState } from 'react';
export default function UpgradeScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const [loadingTier, setLoadingTier] = useState<string | null>(null);

  const upgrade = async (tier: typeof PLAN_DEFINITIONS[number]['tier']) => {
    try {
      setLoadingTier(tier);
      const res = await getDataSource().createCheckoutSession(tier);
      if (res?.url) {
        if (await InAppBrowser.isAvailable()) {
          const result = await InAppBrowser.openAuth(res.url, 'aastryout://upgrade', {
            // iOS Properties
            dismissButtonStyle: 'cancel',
            preferredBarTintColor: colors.bg,
            preferredControlTintColor: colors.primary,
            readerMode: false,
            animated: true,
            modalPresentationStyle: 'fullScreen',
            modalTransitionStyle: 'coverVertical',
            modalEnabled: true,
            enableBarCollapsing: false,
            // Android Properties
            showTitle: true,
            toolbarColor: colors.bg,
            secondaryToolbarColor: colors.border,
            navigationBarColor: colors.bg,
            navigationBarDividerColor: 'white',
            enableUrlBarHiding: true,
            enableDefaultShare: false,
            forceCloseOnRedirection: false,
            animations: {
              startEnter: 'slide_in_right',
              startExit: 'slide_out_left',
              endEnter: 'slide_in_left',
              endExit: 'slide_out_right'
            },
          });
          // Poll for Stripe Webhook to process the payment
          for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await restoreSession();
            
            // Re-fetch the user to check if plan updated
            const currentUser = useAuthStore.getState().session?.user;
            if (currentUser?.planTier === tier) {
              break; // Successfully upgraded!
            }
          }
        } else {
          // Fallback if in-app browser is not available
          const { Linking } = require('react-native');
          await Linking.openURL(res.url);
          // Assuming user returns manually, wait a bit then refresh
          setTimeout(restoreSession, 3000);
        }
      }
    } catch (err: any) {
      Alert.alert('Checkout Error', err.message || 'Something went wrong.');
    } finally {
      setLoadingTier(null);
    }
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
                  <Text className="text-xl font-display font-bold" style={{ color: colors.ink, marginBottom: 12 }}>
                    {item.name}
                  </Text>
                  <View className="flex-row items-baseline mb-4">
                    <Text className="text-lg font-sans mr-1" style={{ color: colors.inkMuted }}>USD</Text>
                    <Text className="text-4xl font-bold font-display" style={{ color: colors.primary }}>
                      {item.price}
                    </Text>
                    <Text className="text-sm font-sans ml-1" style={{ color: colors.inkMuted }}>
                      /year
                    </Text>
                  </View>
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
                  loading={loadingTier === item.tier}
                />
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
