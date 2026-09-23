import { useEffect, useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, Button } from '@/components/ui';
import { getNextTier, sellsExtraTeams, usageFraction } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';
import {
  NUDGE_THRESHOLD,
  buildNudgeMessage,
  effectiveLimit,
  maybeSendUsageNudgePush,
  type UsageMetric,
} from '@/lib/usageNudges';

interface Props {
  tier: PlanTier;
  metric: UsageMetric;
  count: number;
  /** Plural noun shown in the message, e.g. "players", "teams". Defaults to `metric`. */
  label?: string;
}

/** Shows nothing unless usage is at/above 85% of the plan's limit and below the limit itself
 * (the hard limit already has its own blocking UI elsewhere). Also fires a one-time push
 * notification for the same 85% crossing so the nudge reaches users who aren't in the app. */
export function UsageNudgeBanner({ tier, metric, count, label }: Props) {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const [dismissed, setDismissed] = useState(false);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  const extraTeamLicenses = user?.extraTeamLicenses ?? 0;
  const limit = effectiveLimit(tier, metric, extraTeamLicenses);
  const fraction = usageFraction(limit, count);
  const atLimit = limit !== 'unlimited' && count >= limit;
  const nounLabel = label ?? metric;

  useEffect(() => {
    if (!user?.id) return;
    void maybeSendUsageNudgePush(user.id, tier, metric, count, nounLabel, extraTeamLicenses);
  }, [user?.id, tier, metric, count, nounLabel, extraTeamLicenses]);

  if (dismissed || limit === 'unlimited' || fraction < NUDGE_THRESHOLD || atLimit) return null;

  // Club has no tier above it, but it can still buy teams — so the CTA stays useful there.
  const canBuyTeams = metric === 'teams' && sellsExtraTeams(tier);
  const ctaLabel = canBuyTeams ? 'Add Teams' : getNextTier(tier) ? 'Upgrade' : null;
  const message = buildNudgeMessage(tier, metric, count, nounLabel, extraTeamLicenses);

  return (
    <Card
      className="mb-3 flex-row items-center gap-3"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.warning }}
    >
      <Text className="flex-1 text-sm" style={{ color: colors.ink }}>
        {message}
      </Text>
      <View className="gap-2">
        {ctaLabel && !billingBlocked ? (
          <Button label={ctaLabel} size="sm" onPress={() => navigation.navigate('Upgrade')} />
        ) : null}
        <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
          <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
