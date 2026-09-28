import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, Button } from '@/components/ui';
import { hasLiveSubscription } from '@/lib/planChange';
import { getPlanDefinition } from '@/data/plans';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { dismissPlanNotice, isPlanNoticeDismissed } from '@/lib/planNoticeSession';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Notice that a plan change is already scheduled. Shown right after login until
 * dismissed, then not again in this login session (see planNoticeSession).
 *
 * Both changes it reports are deferred to the end of the paid term, so neither
 * alters anything visible the moment it is chosen: a cancellation leaves the
 * subscription `active`, and a downgrade leaves the current price running while
 * Stripe holds the lower one in a schedule. Without this the only available
 * reading is "I chose it and nothing happened". The web app shows the same
 * banner (SubscriptionEndingBanner in Athlete-Assessment-web).
 */
export function SubscriptionEndingBanner() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const [, rerender] = useState(0);
  const dismissed = isPlanNoticeDismissed(user?.id);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  const cancelAt = user?.subscriptionCancelAt;
  const pendingTier = user?.pendingPlanTier;
  const pendingAt = user?.pendingPlanChangeAt;

  // A cancellation outranks a scheduled downgrade: if the subscription is ending
  // outright, the tier it would have moved to on the way is beside the point.
  const kind = cancelAt != null ? 'cancel' : pendingTier && pendingAt != null ? 'downgrade' : null;

  if (dismissed || kind == null || !user || !hasLiveSubscription(user.subscriptionStatus)) return null;

  const planName = getPlanDefinition(user.planTier).name;
  const message =
    kind === 'cancel'
      ? `Cancelled, your ${planName} plan stays active until ${formatDate(cancelAt!)}, then the account moves to Free. You can restart it any time before then.`
      : `Your plan changes from ${planName} to ${getPlanDefinition(pendingTier!).name} on ${formatDate(pendingAt!)}. You keep ${planName} until then, nothing changes today.`;

  return (
    <Card
      className="mb-3 flex-row items-center gap-3"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.warning }}
    >
      <Text className="flex-1 text-sm" style={{ color: colors.ink }}>
        {message}
      </Text>
      <View className="gap-2">
        {!billingBlocked ? (
          <Button label="Manage Plan" size="sm" onPress={() => navigation.navigate('Upgrade')} />
        ) : null}
        <Pressable onPress={() => {
            if (user) dismissPlanNotice(user.id);
            rerender((n) => n + 1);
          }} hitSlop={8}>
          <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
