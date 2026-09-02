import { Text, View, Alert, Pressable, Switch } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen } from '@/components/ui';
import { useApplyReferralCodeMutation, useReferralSummaryQuery } from '@/features/queries';
import {
  PLAN_DEFINITIONS,
  formatCad,
  formatPlanPrice,
  getPlanDefinition,
  getTeamAllowance,
  sellsExtraTeams,
} from '@/data/plans';
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
  const [extraTeams, setExtraTeams] = useState(1);
  const [buyingTeams, setBuyingTeams] = useState(false);
  // Monthly billing is temporarily hidden — every checkout goes through yearly for now.
  const billingInterval = 'year' as const;

  // Loyalty program: spend existing credit, and enter someone else's code.
  const referralQuery = useReferralSummaryQuery();
  const applyCodeMut = useApplyReferralCodeMutation();
  const [referralCode, setReferralCode] = useState('');
  const [applyCredits, setApplyCredits] = useState(true);

  const creditCents = referralQuery.data?.balanceCents ?? 0;
  const hasCredit = creditCents > 0;
  // The discount is sized server-side against the real line total; this is only
  // whether to ask for it at all.
  const useCredits = hasCredit && applyCredits;

  useFocusEffect(
    useCallback(() => {
      restoreSession(true);
      qc.invalidateQueries({ queryKey: queryKeys.profile });
      qc.invalidateQueries({ queryKey: queryKeys.referralSummary });
    }, [restoreSession, qc])
  );

  const submitReferralCode = async () => {
    const code = referralCode.trim();
    if (!code) return;
    try {
      await applyCodeMut.mutateAsync(code);
      setReferralCode('');
      Alert.alert(
        'Code Applied',
        'Thanks! The coach who referred you earns credit once your subscription is paid.'
      );
    } catch (e: any) {
      // apply_referral_code raises customer-facing wording, so show it as-is.
      Alert.alert('Referral Code', e?.message ?? 'That code could not be applied.');
    }
  };

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
      const res = await getDataSource().createCheckoutSession(tier, billingInterval, {
        applyCredits: useCredits,
      });
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
      // Any credit spent was debited by the webhook, so the balance shown here
      // is stale the moment checkout completes.
      qc.invalidateQueries({ queryKey: queryKeys.referralSummary });
    }
  };

  const currentTier = user?.planTier ?? 'free';
  const currentLicenses = user?.extraTeamLicenses ?? 0;
  const currentPlan = getPlanDefinition(currentTier);
  const canBuyTeams = sellsExtraTeams(currentTier);
  const extraTeamPrice = currentPlan.extraTeamPriceCents ?? 0;

  // Extra teams are an add-on subscription on top of the current plan (Club only), so
  // this checkout must not go through `upgrade` — that one switches the plan tier.
  const buyTeams = async () => {
    try {
      setBuyingTeams(true);
      const res = await getDataSource().createTeamLicenseCheckoutSession(extraTeams, {
        applyCredits: useCredits,
      });
      if (!res?.url) return;
      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.openAuth(res.url, 'aastryout://upgrade', {
          dismissButtonStyle: 'cancel',
          preferredBarTintColor: colors.bg,
          preferredControlTintColor: colors.primary,
          modalEnabled: true,
          showTitle: true,
          toolbarColor: colors.bg,
          forceCloseOnRedirection: true,
        });
      } else {
        const { Linking } = require('react-native');
        await Linking.openURL(res.url);
      }
      // The webhook grants the licenses, so poll the profile the same way `upgrade` does.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        if ((useAuthStore.getState().session?.user?.extraTeamLicenses ?? 0) >= currentLicenses + extraTeams) break;
      }
    } catch (err: any) {
      Alert.alert('Checkout Error', err.message || 'Something went wrong.');
    } finally {
      setBuyingTeams(false);
      qc.invalidateQueries({ queryKey: queryKeys.referralSummary });
    }
  };

  return (
    <Screen scroll padded={false}>
      <View className="px-4 pb-8">
        <Header title="Upgrade Plan" subtitle={`Current: ${user?.planTier ?? 'free'}`} showBack />

        {/* Loyalty credit — applied to whichever checkout is started below. */}
        {hasCredit ? (
          <Card accent className="mb-4 gap-2">
            <View className="flex-row justify-between items-center">
              <View className="flex-1 pr-3">
                <Text className="font-display font-bold text-lg" style={{ color: colors.ink }}>
                  {formatCad(creditCents)} loyalty credit
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {applyCredits
                    ? 'Will be applied to your next payment below.'
                    : 'Saved for a later payment.'}
                </Text>
              </View>
              <Switch
                value={applyCredits}
                onValueChange={setApplyCredits}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#ffffff"
              />
            </View>
          </Card>
        ) : null}

        {/* Referral code entry — only meaningful before the first paid plan, and
            only once, so it disappears as soon as one has been attached. */}
        {referralQuery.data &&
        !referralQuery.data.redeemedByCode &&
        user?.subscriptionStatus !== 'active' &&
        user?.subscriptionStatus !== 'trialing' ? (
          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Have a referral code?
            </Text>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Enter the 9-character code a coach shared with you. They earn credit once your
              subscription is paid.
            </Text>
            <Input
              placeholder="e.g. K7M2QX9BD"
              value={referralCode}
              onChangeText={(t) => setReferralCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
            />
            <Button
              label="Apply Code"
              variant="secondary"
              onPress={submitReferralCode}
              loading={applyCodeMut.isPending}
              disabled={!referralCode.trim()}
            />
          </Card>
        ) : null}

        {canBuyTeams ? (
          <Card className="mb-4 gap-2">
            <Text className="font-display font-bold text-lg" style={{ color: colors.ink }}>
              Add Teams
            </Text>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Your plan includes {currentPlan.limits.teams} teams. Additional teams are{' '}
              {formatCad(extraTeamPrice)} each per year.
              {currentLicenses > 0
                ? ` You've purchased ${currentLicenses} so far, for a cap of ${getTeamAllowance(currentTier, currentLicenses)} teams.`
                : ''}
            </Text>
            <View className="flex-row items-center justify-between mt-2">
              <View className="flex-row items-center gap-4">
                <Pressable onPress={() => setExtraTeams((n) => Math.max(1, n - 1))} hitSlop={8}>
                  <Text className="text-2xl" style={{ color: colors.primary }}>
                    −
                  </Text>
                </Pressable>
                <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
                  {extraTeams}
                </Text>
                <Pressable onPress={() => setExtraTeams((n) => Math.min(50, n + 1))} hitSlop={8}>
                  <Text className="text-2xl" style={{ color: colors.primary }}>
                    +
                  </Text>
                </Pressable>
              </View>
              <Text className="font-display font-bold" style={{ color: colors.primary }}>
                {formatCad(extraTeamPrice * extraTeams)}/yr
              </Text>
            </View>
            <Button
              label={`Add ${extraTeams} team${extraTeams === 1 ? '' : 's'}`}
              onPress={buyTeams}
              loading={buyingTeams}
            />
          </Card>
        ) : null}
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
                  <Text className="text-sm mb-3" style={{ color: colors.inkMuted }}>
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
                      <Text className="text-base" style={{ color: markColor }}>{f.included ? '✓' : '○'}</Text>
                      <Text className="text-base" style={{ color: f.included ? (f.fee ? colors.warning : colors.ink) : colors.inkMuted }}>
                        {f.label}
                      </Text>
                    </View>
                    {f.subItems?.map((sub) => (
                      <Text key={sub} className="text-md ml-6" style={{ color: colors.warning }}>
                        + {sub}
                      </Text>
                    ))}
                  </View>
                );
              })}

              <Text className="text-xs mt-1" style={{ color: colors.inkFaint }}>
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
