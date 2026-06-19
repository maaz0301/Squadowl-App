import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import type { PlanTier } from '@/data/types';
import { useUser } from '@/state/authStore';

interface Props {
  feature: keyof ReturnType<typeof getPlanDefinition>['limits'];
  children?: React.ReactNode;
  title?: string;
}

export function PlanGate({ feature, children, title }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const tier = user?.planTier ?? 'free';

  if (canUseFeature(tier, feature)) return <>{children}</>;

  const required = PLAN_REQUIRED[feature] ?? 'club';

  return (
    <Card accent className="gap-3 my-4">
      <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
        {title ?? 'Upgrade Required'}
      </Text>
      <Text style={{ color: colors.inkMuted }}>
        This feature requires the {required.charAt(0).toUpperCase() + required.slice(1)} plan or
        higher. You're on {tier}.
      </Text>
      <Button label="View Plans" onPress={() => router.push('/(app)/upgrade')} />
    </Card>
  );
}

const PLAN_REQUIRED: Partial<Record<keyof ReturnType<typeof getPlanDefinition>['limits'], PlanTier>> = {
  teamBuilder: 'club',
  aiSummaries: 'club',
  shareLinks: 'club',
  seasonHub: 'coach',
  guardianPortal: 'coach',
  enterprise: 'association',
  qrRegistration: 'coach',
};
