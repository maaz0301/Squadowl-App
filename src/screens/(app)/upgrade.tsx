import { Text, View, Alert, Pressable, Switch } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useState, useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Input, Screen } from '@/components/ui';
import { FeatureBlockGate } from '@/components/FeatureBlockGate';
import {
  useApplyReferralCodeMutation,
  useReferralSummaryQuery,
  usePlatformBlockedFeaturesQuery,
  usePlatformBlockedPlanTiersQuery,
  usePlanPriceOverridesQuery,
  useVideoStorageQuery,
} from '@/features/queries';
import { isVideoStorageTier } from '@/data/videoStorage';
import {
  PLAN_DEFINITIONS,
  formatCad,
  formatPlanPrice,
  getPlanDefinition,
  getTeamAllowance,
  getTierRank,
  sellsExtraTeams,
} from '@/data/plans';
import type { PlanTier } from '@/data/types';
import {
  buildDowngradeImpact,
  planChangeRoute,
  hasLiveSubscription,
  planChangeDirection,
} from '@/lib/planChange';
import { useUser, useAuthStore } from '@/state/authStore';
import { getDataSource } from '@/data';
import { useTeamsQuery, useTryoutSummariesQuery } from '@/features/queries';

/** Alert.alert as a promise, so the downgrade flow can await the coach's answer. */
function confirmAsync(options: {
  title: string;
  message: string;
  confirmLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(options.title, options.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: options.confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function UpgradeScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  // Videos are deleted when the plan ends or drops below Coach+, so anything that
  // could do that goes through the video deletion warning first.
  const videoStorage = useVideoStorageQuery().data;
  const hasStoredVideos = (videoStorage?.videoCount ?? 0) > 0;
  const user = useUser();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const qc = useQueryClient();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  // Prices the founder changed from the console; re-renders this screen once they arrive.
  usePlanPriceOverridesQuery();
  const { data: blockedPlanTiers } = usePlatformBlockedPlanTiersQuery();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [extraTeams, setExtraTeams] = useState(1);
  const [buyingTeams, setBuyingTeams] = useState(false);
  // Monthly billing is temporarily hidden — every checkout goes through yearly for now.
  const billingInterval = 'year' as const;

  // Loyalty program: spend existing credit, and enter someone else's code.
  const referralQuery = useReferralSummaryQuery();
  const applyCodeMut = useApplyReferralCodeMutation();

  // Usage behind the downgrade warning: what the account has today, measured
  // against the lower plan's caps. The dashboard already holds both of these
  // lists, so on the ordinary path here they come from cache; the summaries
  // read is the light one, without rosters or scores.
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutSummariesQuery();
  const [referralCode, setReferralCode] = useState('');
  const [applyCredits, setApplyCredits] = useState(true);

  const creditCents = referralQuery.data?.balanceCents ?? 0;
  // Loyalty program is a platform-wide block: while it's off, existing credit
  // is neither shown nor spendable — the founder turning it off means turning
  // it off everywhere, not just hiding the referral/redeem screens.
  const loyaltyBlocked = (platformBlockedFeatures ?? []).includes('loyalty');
  const hasCredit = creditCents > 0 && !loyaltyBlocked;
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

  const startCheckout = async (tier: PlanTier) => {
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

  /**
   * Switches to any tier, in either direction. The two directions take
   * deliberately different routes.
   *
   * An **upgrade** with a live subscription goes through the Stripe portal,
   * which swaps the plan on the existing subscription and charges only the
   * prorated difference for the time left (the portal is configured for that —
   * see create-portal-session). It used to go through Checkout, which billed
   * the full price for a new year and forfeited the time already paid for; that
   * is what an upgrade from Coach to Coach+ charged CAD$69.99 for. An account
   * with no live subscription still starts an ordinary Checkout.
   *
   * A **downgrade** also uses the portal, where it is scheduled rather than
   * applied: the account keeps the tier it has paid for until the term ends.
   */
  const switchPlan = async (tier: PlanTier) => {
    const direction = planChangeDirection(currentTier, tier);
    if (direction === 'current') return;

    if (direction === 'upgrade') {
      const confirmedUpgrade = await confirmUpgrade(tier);
      if (!confirmedUpgrade) return;
      if (planChangeRoute(tier, user?.subscriptionStatus) === 'portal') {
        await openPortal();
        return;
      }
      await startCheckout(tier);
      return;
    }

    if (hasStoredVideos && !isVideoStorageTier(tier)) {
      navigation.navigate('CancelVideoStorage', { reason: 'plan' });
      return;
    }

    const confirmed = await confirmDowngrade(tier);
    if (!confirmed) return;

    if (planChangeRoute(tier, user?.subscriptionStatus) === 'portal') {
      await openPortal();
      return;
    }
    await startCheckout(tier);
  };

  /**
   * Says out loud what an upgrade costs before sending anyone to Stripe.
   *
   * Only shown when there is a subscription to lose — a first-time subscriber
   * forfeits nothing and goes straight to Checkout.
   */
  const confirmUpgrade = async (tier: PlanTier) => {
    if (!hasLiveSubscription(user?.subscriptionStatus)) return true;
    const target = getPlanDefinition(tier);
    return confirmAsync({
      title: `Upgrade to ${target.name}?`,
      message:
        `You'll only pay the difference for the time left on your ${currentPlan.name} plan, not the full ` +
        `${target.name} price. You'll finish the change in Stripe, where the exact amount is shown before you confirm.`,
      confirmLabel: 'Continue',
    });
  };

  /** The "here's what this costs you" gate in front of a downgrade. */
  const confirmDowngrade = async (tier: PlanTier) => {
    const impact = buildDowngradeImpact({
      from: currentTier,
      to: tier,
      teamCount: teamsQuery.data?.length,
      assessmentCount: tryoutsQuery.data?.length,
      extraTeamLicenses: currentLicenses,
    });
    const target = getPlanDefinition(tier);
    const ok = await confirmAsync({
      title: `Switch down to ${target.name}?`,
      message: impact.length
        ? `${impact.join('\n\n')}\n\nYou'll finish the change in Stripe, where the new price and any credit for the rest of this term are shown before you confirm.`
        : `${target.name} covers everything you're using today. You'll finish the change in Stripe, where the new price and any credit for the rest of this term are shown before you confirm.`,
      confirmLabel: `Switch to ${target.name}`,
    });
    return ok;
  };

  // Extra teams are an add-on subscription on top of the current plan (Coach+ and Club), so
  // this checkout must not go through `switchPlan` — that one switches the plan tier.
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

  if ((platformBlockedFeatures ?? []).includes('billing')) {
    return (
      <Screen scroll padded={false}>
        <View className="px-4 pb-8">
          <Header title="Plans & Billing" showBack />
          <FeatureBlockGate feature="billing" />
        </View>
      </Screen>
    );
  }

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
        {!loyaltyBlocked &&
        referralQuery.data &&
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

        {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
          <View className="mb-2">
            <Button
              label="Manage Subscription & Bills"
              variant="secondary"
              onPress={hasStoredVideos ? () => navigation.navigate('CancelVideoStorage', { reason: 'plan' }) : openPortal}
              loading={loadingPortal}
            />
            <Text className="text-xs text-center mt-2" style={{ color: colors.inkMuted }}>
              Manage your subscription, change billing details, or download past invoices via the Stripe portal.
            </Text>
          </View>
        ) : null}

        {PLAN_DEFINITIONS.map((item) => {
          const isCurrent = user?.planTier === item.tier;
          const isTierBlocked = !isCurrent && (blockedPlanTiers ?? []).includes(item.tier);
          // Legacy tiers ('pro'/'association') retired from the hierarchy still
          // exist on un-migrated accounts; getTierRank() ranks anything it
          // doesn't recognise as Free, so every real tier still reads as a step
          // up rather than the buttons silently disappearing.
          const currentRank = getTierRank(currentTier);
          const targetRank = getTierRank(item.tier);
          const isUpgrade = !isCurrent && targetRank > currentRank;
          const isDowngrade = !isCurrent && targetRank < currentRank;
          const yearly = formatPlanPrice(item, 'year');
          // List-price difference against the plan in force, so the direction of
          // the change is legible before reading any feature list. Stripe still
          // shows what is actually owed today — proration is settled there.
          const priceDelta =
            item.pricing && currentPlan.pricing
              ? item.pricing.year.amountCents - currentPlan.pricing.year.amountCents
              : item.pricing
                ? item.pricing.year.amountCents
                : currentPlan.pricing
                  ? -currentPlan.pricing.year.amountCents
                  : 0;
          return (
            <Card
              key={item.tier}
              accent={item.highlight || isCurrent}
              className="mb-4 gap-3"
              // The plan you're on should be findable at a glance while
              // scrolling a stack of four near-identical cards.
              style={isCurrent ? { borderColor: colors.primary, borderWidth: 2 } : undefined}
            >
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
                {item.highlight && !isCurrent ? <Badge label="Popular" variant="success" /> : null}
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

              {/* Extra teams are an add-on to the plan in force, so the stepper
                  lives on the current Coach+/Club card rather than its own tile. */}
              {isCurrent && canBuyTeams ? (
                <View
                  className="gap-2 mt-2 pt-3"
                  style={{ borderTopWidth: 1, borderTopColor: colors.border }}
                >
                  <Text className="font-display font-bold" style={{ color: colors.ink }}>
                    Add Teams
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Your plan includes {currentPlan.limits.teams} teams. Additional teams are{' '}
                    {formatCad(extraTeamPrice)} each per year.
                    {currentLicenses > 0
                      ? ` You've purchased ${currentLicenses} so far, for a cap of ${getTeamAllowance(currentTier, currentLicenses)} teams.`
                      : ''}
                  </Text>
                  <View className="flex-row items-center justify-between mt-1">
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
                </View>
              ) : null}

              {isCurrent ? (
                <Button
                  label="✓ Your Plan"
                  variant="secondary"
                  disabled
                  style={{ borderColor: colors.primary, backgroundColor: 'rgba(255,107,43,0.10)', opacity: 1 }}
                />
              ) : isTierBlocked ? (
                <View className="gap-2">
                  <Button label="Currently unavailable" variant="secondary" disabled />
                  <Text className="text-xs text-center" style={{ color: colors.inkFaint }}>
                    Not open for new signups or upgrades right now.
                  </Text>
                </View>
              ) : (
                <View className="gap-2">
                  {/* Direction and price change read together, above the button:
                      the one thing every card needs to answer is "is this a step
                      up or down, and by how much". */}
                  <View className="flex-row items-center justify-between">
                    <Badge
                      label={isUpgrade ? '↑ Upgrade' : '↓ Move down'}
                      variant={isUpgrade ? 'brand' : 'info'}
                    />
                    {priceDelta !== 0 ? (
                      <Text
                        className="text-xs font-bold"
                        style={{ color: priceDelta > 0 ? colors.inkMuted : colors.success }}
                      >
                        {priceDelta > 0 ? '+' : '−'}
                        {formatCad(Math.abs(priceDelta))}/yr
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    label={isUpgrade ? `Switch to ${item.name}` : `Move down to ${item.name}`}
                    // Both directions get a real, visible button — a downgrade
                    // people can't find is the gap this screen started with.
                    variant={isUpgrade && item.highlight ? 'primary' : 'secondary'}
                    onPress={() => switchPlan(item.tier)}
                    loading={loadingTier === item.tier || loadingPortal}
                  />
                  {/* The two directions bill so differently that the button
                      alone would mislead: one charges only the prorated
                      difference today, the other charges nothing until the current term runs out. */}
                  <Text className="text-xs text-center" style={{ color: colors.inkFaint }}>
                    {isUpgrade
                      ? hasLiveSubscription(user?.subscriptionStatus)
                        ? 'You only pay the difference for the time left on your current plan.'
                        : 'Full price today, billed for a new year.'
                      : planChangeRoute(item.tier, user?.subscriptionStatus) === 'portal'
                        ? 'Takes effect when your current term ends. Nothing changes today.'
                        : 'Starts a new subscription at the lower price.'}
                  </Text>
                </View>
              )}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
