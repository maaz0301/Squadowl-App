import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Card, Header, Screen } from '@/components/ui';
import { useCreateTeamMutation, useCreateTryoutMutation, useTryoutsQuery } from '@/features/queries';
import { useAuthStore, useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useOnboardingStore } from '@/state/uiStore';
import { useThemeColors } from '@/theme/ThemeProvider';

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
  const user = useUser();
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
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
      setCompletedSteps((prev) => [...prev, 0]);
      await updateProfile({
        onboardingSteps: {
          createTeam: true,
          createAssessment: user?.onboardingSteps?.createAssessment ?? false,
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: user?.onboardingSteps?.addPlayers ?? false,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
    } else if (step === 1) {
      const tryout = await createTryout.mutateAsync({
        name: 'First Assessment',
        sport: 'Hockey',
        eventType: 'Tryout',
      });
      setCurrentTryout(tryout.id);
      setCompletedSteps((prev) => [...prev, 1]);
      await updateProfile({
        onboardingSteps: {
          createTeam: user?.onboardingSteps?.createTeam ?? false,
          createAssessment: true,
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: user?.onboardingSteps?.addPlayers ?? false,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
      setStep(2);
      return;
    } else if (step === 2) {
      const tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      if (tryoutId) {
        setCompletedSteps((prev) => [...prev, 2]);
        await updateProfile({
          onboardingSteps: {
            createTeam: user?.onboardingSteps?.createTeam ?? false,
            createAssessment: user?.onboardingSteps?.createAssessment ?? false,
            inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
            addPlayers: true,
            scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
          },
        });
        navigation.reset({
          index: 0,
          routes: [{ name: 'App', params: { screen: 'AssessmentFlow', params: { screen: 'AssessmentRoster', params: { id: tryoutId } } } }],
        });
        return;
      }
    } else if (step === 3) {
      const tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      if (tryoutId) {
        setCompletedSteps((prev) => [...prev, 3]);
        await updateProfile({
          onboardingCompleted: true,
          onboardingSteps: {
            createTeam: user?.onboardingSteps?.createTeam ?? false,
            createAssessment: user?.onboardingSteps?.createAssessment ?? false,
            inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
            addPlayers: user?.onboardingSteps?.addPlayers ?? false,
            scorePlayers: true,
          },
        });
        completeWizard();
        navigation.reset({
          index: 0,
          routes: [{ name: 'App', params: { screen: 'AssessmentFlow', params: { screen: 'AssessmentRinkside', params: { id: tryoutId } } } }],
        });
        return;
      }
    }

    if (step >= STEPS.length - 1) {
      setCompletedSteps((prev) => [...prev, step]);
      await updateProfile({ onboardingCompleted: true });
      completeWizard();
      navigation.reset({
        index: 0,
        routes: [{ name: 'App', params: { screen: 'DashboardMain' } }],
      });
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
                backgroundColor: completedSteps.includes(i) || i === step ? colors.primary : colors.tile,
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
          label="Skip"
          variant="ghost"
          onPress={async () => {
            if (step >= STEPS.length - 1) {
              completeWizard();
              await updateProfile({ onboardingCompleted: true });
              navigation.reset({
                index: 0,
                routes: [{ name: 'App', params: { screen: 'DashboardMain' } }],
              });
            } else {
              setStep((s) => s + 1);
            }
          }}
        />
      </View>
    </Screen>
  );
}
