import { Pressable, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Badge } from '@/components/ui';
import { effectiveTierForTeam, getPlanDefinition, getTierRank } from '@/data/plans';
import type { Team } from '@/data/types';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The plan level a delegated team runs at, shown next to its name. A team
 * handed to a coach works at Coach level inside the club's larger plan, so the
 * badge says so, and `showUpgrade` adds the way to lift it.
 */
export function TeamPlanBadge({
  team,
  showUpgrade = false,
}: {
  team: Pick<Team, 'managed' | 'ownerPlanTier'>;
  showUpgrade?: boolean;
}) {
  const user = useUser();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  if (!team.managed || !team.ownerPlanTier) return null;
  const tier = effectiveTierForTeam(team, user?.planTier ?? 'free');
  const canUpgrade = getTierRank(tier) < getTierRank(team.ownerPlanTier);
  return (
    <>
      <Badge label={`${getPlanDefinition(tier).name} level`} variant="brand" />
      {showUpgrade && canUpgrade ? (
        <Pressable onPress={() => navigation.navigate('Upgrade')} hitSlop={8} accessibilityRole="link">
          <Text className="text-xs font-bold underline" style={{ color: colors.primary }}>
            Upgrade
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}
