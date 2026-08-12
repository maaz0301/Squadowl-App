import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, Platform, Text, View, Pressable } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useQueryClient } from '@tanstack/react-query';

import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { Button, Card, Chip, ErrorState, Header, Input, LoadingState, Screen, Avatar, Badge } from '@/components/ui';
import { canUseFeature, isAtTeamLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import type { DummyTeamOptions } from '@/data/testDataGenerator';
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
} from '@/features/queries';
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
  const [logo, setLogo] = useState<{ uri: string; type: string } | null>(null);
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  const updateTeam = useUpdateTeamMutation();
  const uploadLogo = useUploadTeamLogoMutation();

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');
  const canCollectFees = canUseFeature(user?.planTier ?? 'free', 'payments');

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
      // finishes, so poll a few times instead of assuming it's instant.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (current?.connectChargesEnabled) break;
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
    const count = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', count)) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams'));
      return;
    }
    const team = await createTeam.mutateAsync({ name: data.name, season: data.season });
    // Events hang off a season, so every team gets one up front — the coach
    // never sees it, they just add practices and games on the team screen.
    try {
      await createSeason.mutateAsync({
        name: data.season ? `${data.name} ${data.season}` : `${data.name} Season`,
        teamName: data.name,
        sport: 'Hockey',
        year: data.season,
        teamId: team.id,
      });
    } catch {
      // Non-fatal: the team exists, and its first event will create the season.
    }
    
    if (logo) {
      try {
        const logoUrl = await uploadLogo.mutateAsync({
          teamId: team.id,
          fileUri: logo.uri,
          fileType: logo.type,
        });
        await updateTeam.mutateAsync({ id: team.id, updates: { logoUrl } });
      } catch (e: any) {
        showAlert('Logo Upload Error', 'The team was created, but uploading the logo failed: ' + e.message);
      }
    }

    if (collectsFees && canCollectFees) {
      const dollars = parseFloat(feeInput);
      const cents = !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
      try {
        await updateTeam.mutateAsync({
          id: team.id,
          updates: { collectsFees: true, registrationFeeCents: cents },
        });
      } catch (e: any) {
        showAlert('Fee Setup Error', 'The team was created, but saving the fee failed: ' + e.message);
      }
    }

    navigation.goBack();
  });

  const runDummy = async (options: DummyTeamOptions) => {
    const existing = teamsQuery.data?.length ?? 0;
    if (isAtTeamLimit(user?.planTier ?? 'free', existing + options.teams - 1)) {
      setShowDummy(false);
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'teams', 'teams'));
      return;
    }
    setDummyProgress(null);
    try {
      const res = await genDummy.mutateAsync(options);
      setShowDummy(false);
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
      setDummyProgress(null);
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearDummy.mutateAsync();
      showAlert(
        'Cleared',
        res.assessments === 0
          ? 'No dummy teams to remove.'
          : `Removed ${res.teams} team${res.teams === 1 ? '' : 's'} and ${res.assessments} ` +
          `assessment${res.assessments === 1 ? '' : 's'}.`,
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
                  it — each player's guardian will then be asked to pay this fee, plus TryoutHQ's 0.5%
                  platform fee, from their portal. QR/link assessment registration always stays free.
                </Text>
                {user?.connectChargesEnabled ? (
                  <Badge label="Stripe connected" variant="success" />
                ) : (
                  <>
                    <Text className="text-xs" style={{ color: colors.warning }}>
                      Connect a Stripe account before guardians can pay — you can still create the
                      team now and connect after.
                    </Text>
                    <Button
                      label="Connect with Stripe"
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

        <Button label="Create Team" onPress={onSubmit} loading={createTeam.isPending || uploadLogo.isPending || updateTeam.isPending} />
      </View>

      {isAssociation ? (
        <Card className="mt-6 gap-2">
          <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Testing Tools
          </Text>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Skip the form and generate whole teams — each with a linked assessment, a rubric set,
            and a roster of dummy players you can optionally score.
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-1">
            <Button label="Dummy Data" size="sm" onPress={() => setShowDummy(true)} />
            <Button
              label="Clear Dummy Teams"
              size="sm"
              variant="ghost"
              loading={clearDummy.isPending}
              onPress={runClearDummy}
            />
          </View>
        </Card>
      ) : null}

      <DummyDataModal
        variant="team"
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
