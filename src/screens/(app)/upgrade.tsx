import { Text, View, Alert } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Screen } from '@/components/ui';
import { PLAN_DEFINITIONS, formatPlanPrice } from '@/data/plans';
import { useUser, useAuthStore } from '@/state/authStore';
import { getDataSource } from '@/data';

const TIER_RANKS: Record<string, number> = {
  free: 0,
  coach: 1,
  coach_plus: 2,
  club: 3,
};

export default function UpgradeScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const qc = useQueryClient();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  // Monthly billing is temporarily hidden — every checkout goes through yearly for now.
  const billingInterval = 'year' as const;

  useFocusEffect(
    useCallback(() => {
      restoreSession(true);
      qc.invalidateQueries({ queryKey: queryKeys.profile });
    }, [restoreSession, qc])
  );

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) {
        if (await InAppBrowser.isAvailable()) {
          await InAppBrowser.open(res.url, {
            dismissButtonStyle: 'close',
            preferredBarTintColor: colors.bg,
            preferredControlTintColor: colors.primary,
          });
        } else {
          const { Linking } = require('react-native');
          await Linking.openURL(res.url);
        }
      }
    } catch (err: any) {
      Alert.alert('Portal Error', err.message || 'Something went wrong.');
    } finally {
      setLoadingPortal(false);
    }
  };

  const upgrade = async (tier: typeof PLAN_DEFINITIONS[number]['tier']) => {
    try {
      setLoadingTier(tier);
      const res = await getDataSource().createCheckoutSession(tier, billingInterval);
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
            forceCloseOnRedirection: true,
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
            await restoreSession(true);
            await qc.invalidateQueries({ queryKey: queryKeys.profile });
            
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
          setTimeout(async () => {
            await restoreSession(true);
            await qc.invalidateQueries({ queryKey: queryKeys.profile });
          }, 3000);
        }
      }
    } catch (err: any) {
      Alert.alert('Checkout Error', err.message || 'Something went wrong.');
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <Screen scroll padded={false}>
      <View className="px-4 pb-8">
        <Header title="Upgrade Plan" subtitle={`Current: ${user?.planTier ?? 'free'}`} showBack />
        {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
          <View className="mb-2">
            <Button
              label="Manage Subscription & Bills"
              variant="secondary"
              onPress={openPortal}
              loading={loadingPortal}
            />
            <Text className="text-xs text-center mt-2" style={{ color: colors.inkMuted }}>
              Manage your subscription, change billing details, or download past invoices via the Stripe portal.
            </Text>
          </View>
        ) : null}

        {PLAN_DEFINITIONS.map((item) => {
          const isCurrent = user?.planTier === item.tier;
          // Legacy tiers ('pro'/'association') retired from TIER_RANKS still exist on
          // un-migrated accounts. Treat any unrecognized current tier as rank -1 so
          // upgrade buttons still render instead of silently disappearing for everyone.
          const currentRank = TIER_RANKS[user?.planTier ?? 'free'] ?? -1;
          const yearly = formatPlanPrice(item, 'year');
          return (
            <Card key={item.tier} accent={item.highlight} className="mb-4 gap-3">
              <View className="flex-row justify-between items-start">
                <View>
                  <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
                    {item.name}
                  </Text>
                  <Text className="text-xs mb-3" style={{ color: colors.inkMuted }}>
                    {item.tagline}
                  </Text>
                  <View className="flex-row items-baseline mb-4">
                    <Text className="text-3xl font-bold font-display" style={{ color: colors.primary }}>
                      {yearly.price}
                    </Text>
                    <Text className="text-sm font-sans ml-1.5" style={{ color: colors.inkMuted }}>
                      {yearly.priceNote}
                    </Text>
                  </View>
                </View>
                {isCurrent ? <Badge label="Current" variant="brand" /> : null}
                {item.highlight ? <Badge label="Popular" variant="success" /> : null}
              </View>
              {item.features.map((f) => {
                const markColor = !f.included
                  ? colors.inkFaint
                  : f.allPlans
                    ? colors.success
                    : f.fee
                      ? colors.warning
                      : colors.ink;
                return (
                  <View key={f.label}>
                    <View className="flex-row gap-2">
                      <Text style={{ color: markColor }}>{f.included ? '✓' : '○'}</Text>
                      <Text style={{ color: f.included ? (f.fee ? colors.warning : colors.ink) : colors.inkMuted }}>
                        {f.label}
                      </Text>
                    </View>
                    {f.subItems?.map((sub) => (
                      <Text key={sub} className="text-xs ml-6" style={{ color: colors.warning }}>
                        + {sub}
                      </Text>
                    ))}
                  </View>
                );
              })}

              <Text className="text-[10px] mt-1" style={{ color: colors.inkFaint }}>
                ○ not included · ✓ included ·{' '}
                <Text style={{ color: colors.success }}>green ✓</Text> included on all plans ·{' '}
                <Text style={{ color: colors.warning }}>orange</Text> fees applied to this tier
              </Text>

              {TIER_RANKS[item.tier] > currentRank ? (
                <Button
                  label={`Switch to ${item.name}`}
                  variant={item.highlight ? 'primary' : 'secondary'}
                  onPress={() => upgrade(item.tier)}
                  loading={loadingTier === item.tier}
                />
              ) : null}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
