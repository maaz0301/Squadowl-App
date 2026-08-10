import { useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, Button } from '@/components/ui';
import { getPlanDefinition, getNextTier, usageFraction, formatLimit } from '@/data/plans';
import type { PlanTier } from '@/data/types';

const NUDGE_THRESHOLD = 0.85;

interface Props {
  tier: PlanTier;
  metric: 'teams' | 'players' | 'assessments';
  count: number;
  /** Plural noun shown in the message, e.g. "players", "teams". Defaults to `metric`. */
  label?: string;
}

/** Shows nothing unless usage is at/above 85% of the plan's limit and below the limit itself
 * (the hard limit already has its own blocking UI elsewhere). */
export function UsageNudgeBanner({ tier, metric, count, label }: Props) {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [dismissed, setDismissed] = useState(false);

  const limit = getPlanDefinition(tier).limits[metric];
  const fraction = usageFraction(limit, count);
  const atLimit = limit !== 'unlimited' && count >= limit;

  if (dismissed || limit === 'unlimited' || fraction < NUDGE_THRESHOLD || atLimit) return null;

  const next = getNextTier(tier);
  const nounLabel = label ?? metric;
  const message = next
    ? `You're at ${count} of ${formatLimit(limit)} ${nounLabel} — upgrade to ${next.name} for ${formatLimit(next.limits[metric])} ${nounLabel}.`
    : `You're at ${count} of ${formatLimit(limit)} ${nounLabel}.`;

  return (
    <Card
      className="mb-3 flex-row items-center gap-3"
      style={{ borderLeftWidth: 3, borderLeftColor: colors.warning }}
    >
      <Text className="flex-1 text-sm" style={{ color: colors.ink }}>
        {message}
      </Text>
      <View className="gap-2">
        {next ? (
          <Button label="Upgrade" size="sm" onPress={() => navigation.navigate('Upgrade')} />
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
