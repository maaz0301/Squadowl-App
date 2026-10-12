import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, Platform, Text, View, Pressable } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useQueryClient } from '@tanstack/react-query';

import { DummyDataModal } from '@/components/DummyDataModal';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Button, Card, Chip, ErrorState, Header, Input, LoadingState, Screen, Avatar, Badge, useTypeToConfirm } from '@/components/ui';
import { canUseFeature, isAtTeamLimit, playerRoom, teamRoom, assessmentRoom, ownedTryouts } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
import { SPORTS, type Sport, type Team } from '@/data/types';
import { getDataSource } from '@/data';
import { queryKeys } from '@/lib/queryClient';
import {
  useClearDummyTeamsMutation,
  useCreateSeasonMutation,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useUploadTeamLogoMutation,
  useGenerateDummyTeamsMutation,
  useTeamsQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';
import { useConnectStatus } from '@/features/useConnectStatus';
import { useUser, useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

const FormSchema = z.object({
  name: z.string().min(2, 'Team name required'),
  season: z.string().optional(),
});

type Form = z.infer<typeof FormSchema>;

export default function NewTeamScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const createTeam = useCreateTeamMutation();
  const createSeason = useCreateSeasonMutation();
  const teamsQuery = useTeamsQuery();
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genDummy = useGenerateDummyTeamsMutation((done, total) => setDummyProgress({ done, total }));
  const clearDummy = useClearDummyTeamsMutation();
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [showDummy, setShowDummy] = useState(false);
  const typeToConfirm = useTypeToConfirm();
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [sport, setSport] = useState<Sport>('Hockey');
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [connecting, setConnecting] = useState(false);
  // Covers the whole submit, not just createTeam: the season, the logo, the
  // branding write and the manager invite all run after it, and the button's
  // spinner used to stop between them — the form sat there looking finished
  // while several writes were still in flight.
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const connect = useConnectStatus();

  const updateTeam = useUpdateTeamMutation();
  const uploadLogo = useUploadTeamLogoMutation();

  const showDummyTools = useCanUseDummyData(user?.planTier ?? 'free');
  // Every dummy team also gets a linked evaluation, so the batch is capped by
  // whichever of the two allowances runs out first. Until the evaluations have
  // loaded nothing is offered, rather than guessing a count of zero.
  const tryoutSummaries = useTryoutSummariesQuery(false);
  const dummyTier = user?.planTier ?? 'free';
  const dummyTeamRoom = teamRoom(dummyTier, (teamsQuery.data ?? []).filter((t) => !t.managed).length, user?.extraTeamLicenses ?? 0);
  const dummyEvaluationRoom = tryoutSummaries.data ? assessmentRoom(dummyTier, ownedTryouts(tryoutSummaries.data, teamsQuery.data ?? []).length) : 0;
  const dummyMaxTeams = Math.min(dummyTeamRoom, dummyEvaluationRoom);
  const dummyBlockedBy: 'teams' | 'evaluations' | 'loading' | undefined =
    !tryoutSummaries.data || !teamsQuery.data
      ? 'loading'
      : dummyEvaluationRoom < 1
        ? 'evaluations'
        : dummyTeamRoom < 1
          ? 'teams'
          : undefined;
  const canCollectFees = canUseFeature(user?.planTier ?? 'free', 'payments');
  const canManageTeamCoaches = canUseFeature(user?.planTier ?? 'free', 'teamManagers');

  const connectPayouts = async () => {
    try {
      setConnecting(true);
      const res = await getDataSource().createConnectAccountLink();
      if (!res?.url) return;

      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.openAuth(res.url, 'aastryout://team/new', {
          dismissButtonStyle: 'cancel',
          preferredBarTintColor: colors.bg,
          preferredControlTintColor: colors.primary,
          modalPresentationStyle: 'fullScreen',
        });
      } else {
        const { Linking } = require('react-native');
        await Linking.openURL(res.url);
      }

      // Stripe's account.updated webhook lands a moment after onboarding
      // finishes, so poll a few times instead of assuming it's instant. Waits on
      // the live connect-status refetch rather than the profile flag — see the
      // matching loop in payments.tsx.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: live } = await connect.refetch();
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (live?.chargesEnabled || current?.connectChargesEnabled) break;
      }
    } catch (err: any) {
      showAlert('Connect Error', err.message || 'Something went wrong.');
    } finally {
      setConnecting(false);
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const { control, handleSubmit } = useForm<Form>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', season: '2025-26' },
  });

  const handleSelectLogo = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: false,
      });
      if (result.didCancel || !result.assets?.length) return;
      
      const asset = result.assets[0];
      if (asset.uri && asset.type) {
        setLogo({ uri: asset.uri, type: asset.type });
      }
    } catch (e: any) {
      showAlert('Error', 'Failed to select image: ' + e.message);
    }
  };

  const onSubmit = handleSubmit(async (data) => {
    // Delegated teams belong to the club that pays for them, not to this plan.
    const count = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
    if (isAtTeamLimit(user?.planTier ?? 'free', count, user?.extraTeamLicenses ?? 0)) {
      setLimitMsg(
        buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0)
      );
      return;
    }
    setSubmitting(true);
    try {
      let team;
      try {
        team = await createTeam.mutateAsync({ name: data.name, season: data.season, sport });
      } catch (e: any) {
        showAlert('Error', e?.message || 'Failed to create team.');
        return;
      }

      // createTeam only takes name/season, so the season, the logo and the rest
      // of the settings are follow-up writes — but none of them depends on any
      // of the others, so they go out together. Run one after another they were
      // the bulk of the wait between hitting Create and landing on the team.
      const updates: Partial<Team> = {};
      if (brandColor) updates.brandColor = brandColor;
      if (collectsFees && canCollectFees) {
        const dollars = parseFloat(feeInput);
        updates.collectsFees = true;
        updates.registrationFeeCents =
          !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
      }

      await Promise.all([
        // Events hang off a season, so every team gets one up front — the coach
        // never sees it, they just add practices and games on the team screen.
        // Non-fatal: the team exists, and its first event will create the season.
        createSeason
          .mutateAsync({
            name: data.season ? `${data.name} ${data.season}` : `${data.name} Season`,
            teamName: data.name,
            sport,
            year: data.season,
            teamId: team.id,
          })
          .catch(() => {}),
        // The upload only puts the file in storage and hands back its URL, so
        // the logo has to join the same settings write — which is why this one
        // branch is sequential inside an otherwise parallel batch.
        (async () => {
          let logoUrl: string | undefined;
          if (logo) {
            try {
              logoUrl = await uploadLogo.mutateAsync({
                teamId: team.id,
                fileUri: logo.uri,
                fileType: logo.type,
              });
            } catch (e: any) {
              showAlert('Logo Upload Error', 'The team was created, but uploading the logo failed: ' + e.message);
            }
          }
          const patch = { ...updates, ...(logoUrl ? { logoUrl } : {}) };
          if (Object.keys(patch).length === 0) return;
          try {
            await updateTeam.mutateAsync({ id: team.id, updates: patch });
          } catch (e: any) {
            showAlert('Settings Error', 'The team was created, but saving its settings failed: ' + e.message);
          }
        })(),
        // Coach+/Club only: let the same "creating a team" flow hand it straight
        // to another manager instead of making them find the new team
        // afterward just to invite someone to it. Always 'manager' — see
        // TeamManagersCard for why 'coach' isn't offered as an invite role.
        canManageTeamCoaches && managerEmail.trim()
          ? getDataSource()
              .inviteTeamManager(team.id, managerEmail.trim(), 'manager')
              .catch((e: any) =>
                showAlert('Invite Error', `The team was created, but inviting ${managerEmail.trim()} failed: ` + e.message),
              )
          : null,
      ]);

      // Land straight on the new team's own Settings tab instead of back on the
      // list — a coach who just filled out this form wants to keep configuring
      // the team they made (branding, fees, managers), not re-find it in the list.
      navigation.replace('TeamDetail', { id: team.id, tab: 'settings' });
    } finally {
      setSubmitting(false);
    }
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = (teamsQuery.data ?? []).filter((t) => !t.managed).length;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1, user?.extraTeamLicenses ?? 0)) {
      setShowDummy(false);
      setLimitMsg(
        buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams', user?.extraTeamLicenses ?? 0)
      );
      return;
    }
    if (options.teams > dummyMaxTeams) {
      setShowDummy(false);
      setLimitMsg(buildLimitReachedMessage(dummyTier, 'assessments', 'evaluations'));
      return;
    }
    setDummyProgress(null);
    try {
      const res = await genDummy.mutateAsync(options);
      showAlert(
        'Dummy teams created',
        `Created ${res.teams} team${res.teams === 1 ? '' : 's'} with ${res.assessments} linked ` +
        `assessment${res.assessments === 1 ? '' : 's'}, ${res.players} players, and ` +
        `${res.evaluations} evaluations.`,
      );
      navigation.goBack();
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to generate dummy teams.');
    } finally {
      // In `finally`, not after the await: a partial run still created real
      // teams, and leaving the modal open over a stale form made it look like
      // nothing had happened at all.
      setShowDummy(false);
      setDummyProgress(null);
    }
  };

  const confirmClearDummy = () =>
    typeToConfirm.ask({
      title: 'Clear Dummy Teams',
      message: "Remove all generated dummy teams and their evaluations? This can't be undone.",
      onConfirm: () => void runClearDummy(),
    });

  const runClearDummy = async () => {
    try {
      const res = await clearDummy.mutateAsync();
      showAlert(
        'Cleared',
        res.assessments === 0
          ? 'No dummy teams to remove.'
          : `Removed ${res.teams} team${res.teams === 1 ? '' : 's'} and ${res.assessments} ` +
          `evaluation${res.assessments === 1 ? '' : 's'}.`,
      );
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to clear dummy teams.');
    }
  };

  if (teamsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (teamsQuery.isError) {
    return (
      <Screen scroll>
        <Header title="New Team" showBack />
        <ErrorState message="Could not load teams." onRetry={() => teamsQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {typeToConfirm.modal}
      <Header title="New Team" showBack />
      <View className="gap-4 mt-2">
        <Pressable onPress={handleSelectLogo} className="items-center mb-2 mt-4">
          <View className="mb-3">
            <Avatar
              uri={logo?.uri}
              first="T"
              last="M"
              size={80}
            />
          </View>
          <Text className="font-bold text-sm" style={{ color: colors.primary }}>
            {logo ? 'Change Team Logo' : 'Upload Team Logo'}
          </Text>
        </Pressable>

        <Controller
          control={control}
          name="name"
          render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
            <Input label="Team Name" onBlur={onBlur} onChangeText={onChange} value={value} error={error?.message} />
          )}
        />
        <Controller
          control={control}
          name="season"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input label="Season (optional)" onBlur={onBlur} onChangeText={onChange} value={value ?? ''} />
          )}
        />

        <View className="gap-2">
          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Sport
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SPORTS.map((s) => (
              <Chip key={s} label={s} active={sport === s} onPress={() => setSport(s)} />
            ))}
          </View>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Player cards, labels and the sign-up form follow the sport (a skating team has Skaters, with no positions).
          </Text>
        </View>

        <TeamColorPicker value={brandColor} onChange={setBrandColor} label="Team colour (optional)" />

        {canManageTeamCoaches ? (
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Invite a manager (optional)
            </Text>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              Give them this team's roster, schedule, and chat as soon as it's created, and let
              them create its evaluations, but nothing else on your account. They'll get an email with an Accept Invitation
              button. If they don't have a SquadOwl account yet, it asks them to create one, and access is granted automatically when they do.
            </Text>
            <Input
              label="Email address"
              value={managerEmail}
              onChangeText={setManagerEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="manager@example.com"
            />
          </View>
        ) : null}

        {canCollectFees ? (
          <>
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Are you collecting fees?
              </Text>
              <View className="flex-row gap-2">
                <Chip label="No" active={!collectsFees} onPress={() => setCollectsFees(false)} />
                <Chip label="Yes" active={collectsFees} onPress={() => setCollectsFees(true)} />
              </View>
            </View>

            {collectsFees ? (
              <Card className="gap-2">
                <Input
                  label="Fee per player (CAD)"
                  value={feeInput}
                  onChangeText={setFeeInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Creating this team creates (or reuses) its season and adds everyone on the roster to
                  it, each player's guardian will then be asked to pay this fee, plus SquadOwl's 0.5%
                  platform fee, from their portal. QR/link evaluation registration always stays free.
                </Text>
                {connect.chargesEnabled ? (
                  <Badge label="Stripe connected" variant="success" />
                ) : (
                  <>
                    <Text className="text-xs" style={{ color: colors.warning }}>
                      {connect.onboardingIncomplete
                        ? "Your Stripe account isn't finished, Stripe needs more information before it will accept charges. You can still create the team now and finish after."
                        : 'Connect a Stripe account before guardians can pay, you can still create the team now and connect after.'}
                    </Text>
                    <Button
                      label={connect.onboardingIncomplete ? 'Continue Stripe Setup' : 'Connect with Stripe'}
                      variant="secondary"
                      size="sm"
                      loading={connecting}
                      onPress={connectPayouts}
                    />
                  </>
                )}
              </Card>
            ) : null}
          </>
        ) : null}

        <Button label="Create Team" onPress={onSubmit} loading={submitting} />
      </View>

      {showDummyTools ? (
        <Card className="mt-6 gap-2">
          <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Testing Tools
          </Text>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Skip the form and generate whole teams, each with a linked evaluation, a rubric set,
            and a roster of dummy players you can optionally score.
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-1">
            <Button label="Dummy Data" size="sm" onPress={() => setShowDummy(true)} />
            <Button
              label="Clear Dummy Teams"
              size="sm"
              variant="ghost"
              loading={clearDummy.isPending}
              onPress={confirmClearDummy}
            />
          </View>
        </Card>
      ) : null}

      <DummyDataModal
        variant="team"
        maxTeams={dummyMaxTeams}
        teamsBlockedBy={dummyBlockedBy}
        maxPlayersPerTeam={playerRoom(dummyTier, 0)}
        defaultSport={sport}
        visible={showDummy}
        loading={genDummy.isPending}
        progress={dummyProgress ?? undefined}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
