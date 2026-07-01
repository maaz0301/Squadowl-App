import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Screen, Header } from '@/components/ui';
import { useOnboardingStore } from '@/state/uiStore';
import { useAuthStore } from '@/state/authStore';
import { useCreateTeamMutation, useCreateTryoutMutation, useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';

const STEPS = [
  {
    title: 'Create your first team',
    description: 'Teams help organize your assessments and rosters.',
    action: 'Create Team',
  },
  {
    title: 'Set up an assessment',
    description: 'Create a tryout or assessment event for your athletes.',
    action: 'Create Assessment',
  },
  {
    title: 'Add players',
    description: 'Use QR registration or add players manually to your roster.',
    action: 'Continue',
  },
  {
    title: 'Start scoring',
    description: 'Use rinkside scoring to evaluate players against rubrics.',
    action: 'Go to Dashboard',
  },
];

export default function WizardScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState(0);
  const completeWizard = useOnboardingStore((s) => s.completeWizard);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const createTeam = useCreateTeamMutation();
  const createTryout = useCreateTryoutMutation();
  const tryoutsQuery = useTryoutsQuery(false);
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  const current = STEPS[step];

  const handleAction = async () => {
    if (step === 0) {
      await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
    } else if (step === 1) {
      const tryout = await createTryout.mutateAsync({
        name: 'First Assessment',
        sport: 'Hockey',
        eventType: 'Tryout',
      });
      setCurrentTryout(tryout.id);
      setStep(2);
      return;
    } else if (step === 2) {
      const tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      if (tryoutId) {
        navigation.replace(`/(app)/assessment/${tryoutId}/roster`);
        return;
      }
    } else if (step === 3) {
      const tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      if (tryoutId) {
        await updateProfile({ onboardingCompleted: true });
        completeWizard();
        navigation.replace(`/(app)/assessment/${tryoutId}/rinkside`);
        return;
      }
    }

    if (step >= STEPS.length - 1) {
      await updateProfile({ onboardingCompleted: true });
      completeWizard();
      navigation.replace('/(app)/dashboard');
      return;
    }
    setStep((s) => s + 1);
  };

  return (
    <Screen>
      <Header title="Quick Setup" subtitle={`Step ${step + 1} of ${STEPS.length}`} showBack />
      <Card accent className="mt-4 gap-3">
        <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
          {current.title}
        </Text>
        <Text className="text-base" style={{ color: colors.inkMuted }}>
          {current.description}
        </Text>
        <View className="flex-row gap-2 mt-2">
          {STEPS.map((_, i) => (
            <View
              key={i}
              className="flex-1 h-1 rounded-full"
              style={{
                backgroundColor: i <= step ? colors.primary : colors.tile,
              }}
            />
          ))}
        </View>
      </Card>
      <View className="flex-1 justify-end pb-4 gap-3">
        <Button
          label={current.action}
          onPress={handleAction}
          loading={createTeam.isPending || createTryout.isPending}
        />
        <Button
          label="Skip setup"
          variant="ghost"
          onPress={async () => {
            completeWizard();
            await updateProfile({ onboardingCompleted: true });
            navigation.replace('/(app)/dashboard');
          }}
        />
      </View>
    </Screen>
  );
}
