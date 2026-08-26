import { useNavigation } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Card, Header, Screen } from '@/components/ui';
import { useCreateTeamMutation, useCreateTryoutMutation, useTeamsQuery, useTryoutSummariesQuery, useUpdateProfileMutation } from '@/features/queries';
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
  const [createdTeamId, setCreatedTeamId] = useState<string | null>(null);

  const initialData = useMemo(() => {
    const s = user?.onboardingSteps;
    const completed = [];
    if (s?.createTeam) completed.push(0);
    if (s?.createAssessment) completed.push(1);
    if (s?.addPlayers) completed.push(2);
    if (s?.scorePlayers) completed.push(3);

    let startStep = 0;
    if (!completed.includes(0)) startStep = 0;
    else if (!completed.includes(1)) startStep = 1;
    else if (!completed.includes(2)) startStep = 2;
    else if (!completed.includes(3)) startStep = 3;

    return { startStep, completed };
  }, [user?.onboardingSteps]);

  const [step, setStep] = useState(initialData.startStep);
  const [completedSteps, setCompletedSteps] = useState<number[]>(initialData.completed);

  const completeWizard = useOnboardingStore((s) => s.completeWizard);
  const updateProfileMutation = useUpdateProfileMutation();
  const updateProfile = updateProfileMutation.mutateAsync;
  const createTeam = useCreateTeamMutation();
  const createTryout = useCreateTryoutMutation();
  // Only the first assessment's id is read from this — see useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(false);
  const teamsQuery = useTeamsQuery();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  const current = STEPS[step];

  const handleAction = async () => {
    if (step === 0) {
      const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
      setCreatedTeamId(team.id);
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
      setStep(1);
      return;
    } else if (step === 1) {
      let tId = createdTeamId ?? teamsQuery.data?.[0]?.id;
      let createdNewTeam = false;
      if (!tId) {
        const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
        tId = team.id;
        setCreatedTeamId(team.id);
        createdNewTeam = true;
      }

      const tryout = await createTryout.mutateAsync({
        name: 'First Assessment',
        sport: 'Hockey',
        eventType: 'Tryout',
        teamId: tId,
      });
      setCurrentTryout(tryout.id);
      setCompletedSteps((prev) => [...prev, createdNewTeam ? 0 : null, 1].filter((n) => n !== null) as number[]);
      await updateProfile({
        onboardingSteps: {
          createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
          createAssessment: true,
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: user?.onboardingSteps?.addPlayers ?? false,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
      setStep(2);
      return;
    } else if (step === 2) {
      let tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      let createdNewTeam = false;
      let createdNewAssessment = false;

      if (!tryoutId) {
        let tId = createdTeamId ?? teamsQuery.data?.[0]?.id;
        if (!tId) {
          const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
          tId = team.id;
          setCreatedTeamId(team.id);
          createdNewTeam = true;
        }
        const tryout = await createTryout.mutateAsync({
          name: 'First Assessment',
          sport: 'Hockey',
          eventType: 'Tryout',
          teamId: tId,
        });
        tryoutId = tryout.id;
        setCurrentTryout(tryoutId);
        createdNewAssessment = true;
      }

      if (tryoutId) {
        setCompletedSteps((prev) => [...prev, createdNewTeam ? 0 : null, createdNewAssessment ? 1 : null, 2].filter((n) => n !== null) as number[]);
        await updateProfile({
          onboardingSteps: {
            createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
            createAssessment: createdNewAssessment ? true : (user?.onboardingSteps?.createAssessment ?? false),
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
      let tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
      let createdNewTeam = false;
      let createdNewAssessment = false;

      if (!tryoutId) {
        let tId = createdTeamId ?? teamsQuery.data?.[0]?.id;
        if (!tId) {
          const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
          tId = team.id;
          setCreatedTeamId(team.id);
          createdNewTeam = true;
        }
        const tryout = await createTryout.mutateAsync({
          name: 'First Assessment',
          sport: 'Hockey',
          eventType: 'Tryout',
          teamId: tId,
        });
        tryoutId = tryout.id;
        setCurrentTryout(tryoutId);
        createdNewAssessment = true;
      }

      if (tryoutId) {
        setCompletedSteps((prev) => [...prev, createdNewTeam ? 0 : null, createdNewAssessment ? 1 : null, 3].filter((n) => n !== null) as number[]);
        await updateProfile({
          onboardingCompleted: true,
          onboardingSteps: {
            createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
            createAssessment: createdNewAssessment ? true : (user?.onboardingSteps?.createAssessment ?? false),
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
