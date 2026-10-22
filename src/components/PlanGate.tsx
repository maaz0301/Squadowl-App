import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';

interface Props {
  feature: keyof ReturnType<typeof getPlanDefinition>['limits'];
  children?: React.ReactNode;
  title?: string;
  /**
   * Gate against this tier instead of the caller's own account tier. Team
   * screens pass effectiveTierForTeam's result here so a delegated (CLUB
   * mode) team gates on the owning club's plan, not the delegate's own.
   */
  tierOverride?: PlanTier;
}

export function PlanGate({ feature, children, title, tierOverride }: Props) {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const tier = tierOverride ?? user?.planTier ?? 'free';
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  if (canUseFeature(tier, feature)) return <>{children}</>;

  const required = PLAN_REQUIRED[feature] ?? 'club';
  const requiredName = required === 'coach_plus' ? 'Coach+' : required.charAt(0).toUpperCase() + required.slice(1);

  return (
    <Card accent className="gap-3 my-4">
      <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
        {title ?? 'Upgrade Required'}
      </Text>
      <Text style={{ color: colors.inkMuted }}>
        This feature requires the {requiredName} plan or higher. You're on {tier}.
      </Text>
      {billingBlocked ? (
        <Button label="Upgrades unavailable right now" variant="secondary" disabled />
      ) : (
        <Button label="View Plans" onPress={() => navigation.navigate('Upgrade')} />
      )}
    </Card>
  );
}

const PLAN_REQUIRED: Partial<Record<keyof ReturnType<typeof getPlanDefinition>['limits'], PlanTier>> = {
  customRubrics: 'coach',
  exports: 'coach',
  teamBuilder: 'coach_plus',
  aiSummaries: 'coach_plus',
  aiReportComments: 'coach_plus',
  shareLinks: 'coach_plus',
  seasonHub: 'coach',
  guardianPortal: 'coach',
  enterprise: 'club',
  teamManagers: 'coach_plus',
  qrRegistration: 'free',
  payments: 'coach',
};
