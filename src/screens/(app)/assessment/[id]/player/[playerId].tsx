import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  Modal,
  Chip,
  Screen,
} from '@/components/ui';
import {
  useTryoutQuery,
  useUpdatePlayerMutation,
  useDeletePlayerMutation,
  useAiPlayerSummaryMutation,
  useLinkGuardianMutation,
  useInviteMemberMutation,
  useCreateAndInviteMemberMutation,
  useOrgMembersQuery,
  useAthleteHistoryQuery,
  useSeasonsQuery,
  useAddSeasonPlayerMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName } from '@/data/rubrics';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { PlanGate } from '@/components/PlanGate';
import { mockAiPlayerSummary } from '@/data/teamBuilder';

export default function PlayerHubScreen() {
  const assessmentId = useAssessmentId();
  const route = useRoute<any>();
  const { playerId } = route.params || {};
  const id = assessmentId;
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);
  
  const linkGuardianMut = useLinkGuardianMutation();
  const inviteMut = useInviteMemberMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();
  const { data: members = [] } = useOrgMembersQuery();
  
  const player = tryoutQuery.data?.roster.find((p) => p.id === playerId);
  const historyQuery = useAthleteHistoryQuery(player?.athleteId);

  const [showEdit, setShowEdit] = useState(false);
  const [showGuardianLink, setShowGuardianLink] = useState(false);
  const { canManageTeam } = usePermissions();

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  if (!player) return <EmptyState title="Player not found" />;

  const evals = tryoutQuery.data.evals
    .filter((e) => e.playerId === playerId)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Screen scroll>
      <Header title={playerDisplayName(player)} showBack />
      <View className="items-center py-4 gap-2">
        <Avatar first={player.first} last={player.last} pos={player.pos} size={72} />
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          #{player.jersey ?? '—'} · {player.pos ?? '—'} · ID {player.athleteId ?? '—'}
        </Text>
        {player.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
      </View>

        <View className="flex-row items-center gap-2 mt-4 mb-6">
          <Button
            label="Score Player"
            className="flex-1"
            onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScore', params: { id: id, playerId: playerId } })}
          />
          {canManageTeam && <Button label="Edit" variant="secondary" className="flex-1" onPress={() => setShowEdit(true)} />}
        </View>

      <Card className="mb-4 gap-1">
        <View className="flex-row justify-between items-center mb-1">
          <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
            Guardian Access
          </Text>
          {player.linkedGuardianId ? (
            <Badge label="Linked" variant="success" />
          ) : canManageTeam ? (
            <Button
              label="Link Account"
              variant="secondary"
              size="sm"
              onPress={() => setShowGuardianLink(true)}
            />
          ) : (
            <Text style={{ color: colors.inkMuted }}>Not linked</Text>
          )}
        </View>

        {player.guardianName ? (
          <>
            <Text style={{ color: colors.ink }}>{player.guardianName}</Text>
            {player.guardianEmail ? (
              <Text style={{ color: colors.inkMuted }}>{player.guardianEmail}</Text>
            ) : null}
          </>
        ) : (
          <Text style={{ color: colors.inkFaint }}>No guardian info provided.</Text>
        )}
      </Card>

      <Card accent className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Development Summary
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {mockAiPlayerSummary(tryoutQuery.data, playerId!).summary}
        </Text>
        <Text className="text-sm" style={{ color: colors.primary }}>
          Role fit: {mockAiPlayerSummary(tryoutQuery.data, playerId!).role_fit}
        </Text>

        <PlanGate feature="aiSummaries" title="Deep AI Insights (Club+)">
          {tryoutQuery.data.aiAssessments?.[playerId!] ? (
            <View className="mt-2 border-t pt-2" style={{ borderColor: colors.border }}>
              <Text className="font-bold mb-1" style={{ color: colors.primary }}>AI Advanced Analysis</Text>
              <Text style={{ color: colors.inkMuted }}>
                {tryoutQuery.data.aiAssessments[playerId!].summary}
              </Text>
            </View>
          ) : (
            <Button
              label="Generate AI Deep Dive"
              size="sm"
              className="mt-2"
              onPress={() => aiSummary.mutate(playerId!)}
              loading={aiSummary.isPending}
            />
          )}
          {aiSummary.data ? (
            <View className="mt-2 border-t pt-2" style={{ borderColor: colors.border }}>
              <Text className="font-bold mb-1" style={{ color: colors.primary }}>AI Advanced Analysis</Text>
              <Text style={{ color: colors.inkMuted }}>{aiSummary.data.summary}</Text>
              {aiSummary.data.key_strengths.map((s: string) => (
                <Text key={s} className="text-sm" style={{ color: colors.success }}>+ {s}</Text>
              ))}
            </View>
          ) : null}
        </PlanGate>
      </Card>

      {historyQuery.data && (historyQuery.data.pastSeasons.length > 0 || historyQuery.data.pastEvaluations.length > 0) && (
        <Card className="mb-4 gap-2 border-brand">
          <Text className="font-display font-bold" style={{ color: colors.primary }}>
            Historical Data
          </Text>
          {historyQuery.data.pastSeasons.length > 0 && (
            <View>
              <Text className="text-sm font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Past Seasons</Text>
              {historyQuery.data.pastSeasons.map((s) => (
                <View key={s.seasonId} className="flex-row items-center gap-2 mb-1">
                  <Badge label={s.seasonName} variant="info" />
                  <Text style={{ color: colors.ink }}>{s.teamName}</Text>
                </View>
              ))}
            </View>
          )}
          {historyQuery.data.pastEvaluations.length > 0 && (
            <View className="mt-2">
              <Text className="text-sm font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Past Evals ({historyQuery.data.pastEvaluations.length})</Text>
              {historyQuery.data.pastEvaluations.map((ev, i) => (
                <View key={ev.id} className="mb-1 border-b pb-1" style={{ borderColor: colors.border }}>
                  <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                    {ev.session} · {ev.recommendation || 'No Rec'}
                  </Text>
                  {ev.strengths ? <Text className="text-xs" style={{ color: colors.success }}>+ {ev.strengths}</Text> : null}
                  {ev.improve ? <Text className="text-xs" style={{ color: colors.inkMuted }}>→ {ev.improve}</Text> : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      )}

      <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
        Evaluations ({evals.length})
      </Text>
      {evals.length === 0 ? (
        <EmptyState title="No evaluations yet" message="Tap Score Player to add the first evaluation." />
      ) : (
        evals.map((ev) => (
          <Card key={ev.id} className="mb-2 gap-1">
            <View className="flex-row justify-between">
              <Text className="font-bold" style={{ color: colors.ink }}>
                {ev.session} · {ev.date}
              </Text>
              {ev.recommendation ? <Badge label={ev.recommendation} variant="brand" /> : null}
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {ev.evaluator}
            </Text>
            {ev.strengths ? (
              <Text className="text-sm mt-1" style={{ color: colors.ink }}>
                + {ev.strengths}
              </Text>
            ) : null}
            {ev.improve ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                → {ev.improve}
              </Text>
            ) : null}
            <Button
              label="Edit Score"
              size="sm"
              variant="ghost"
              onPress={() =>
                navigation.navigate('AssessmentFlow', { screen: 'AssessmentScore', params: { id: id, playerId: playerId, evalId: ev.id } })
              }
            />
          </Card>
        ))
      )}

      {canManageTeam && (
        <Button
          label="Delete Player"
          variant="danger"
          className="mt-6"
          loading={deletePlayer.isPending}
          onPress={async () => {
            await deletePlayer.mutateAsync(playerId!);
            navigation.goBack();
          }}
        />
      )}

      <Modal visible={showEdit} title="Edit Player" onClose={() => setShowEdit(false)}>
        <AddPlayerForm
          defaultValues={player}
          loading={updatePlayer.isPending}
          onSubmit={async (data) => {
            await updatePlayer.mutateAsync({ playerId: playerId!, updates: data });
            setShowEdit(false);
          }}
        />
      </Modal>

      <Modal visible={showGuardianLink} title="Link Guardian" onClose={() => setShowGuardianLink(false)}>
        <View className="gap-3">
          <Text style={{ color: colors.ink }}>
            Link {player.first} to a guardian account to grant them portal access.
          </Text>
          {player.guardianEmail && !player.linkedGuardianId ? (
            <Button
              label={`Invite ${player.guardianEmail}`}
              onPress={async () => {
                const email = player.guardianEmail!;
                try {
                  const member = await inviteMut.mutateAsync({ email, role: 'guardian' });
                  await linkGuardianMut.mutateAsync({
                    guardianId: member.userId!,
                    tryoutId: id!,
                    playerId: player.athleteId!,
                  });
                  setShowGuardianLink(false);
                } catch (error: any) {
                  if (error.message?.includes('User not found')) {
                    // Auto-create the user
                    try {
                      // Generate a random password (e.g. 6 chars)
                      const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
                      const name = player.guardianName || 'Guardian';
                      
                      const newMember = await createAndInviteMut.mutateAsync({
                        email,
                        password: defaultPassword,
                        name,
                        role: 'guardian'
                      });

                      await linkGuardianMut.mutateAsync({
                        guardianId: newMember.userId!,
                        tryoutId: id!,
                        playerId: player.athleteId!,
                      });
                      
                      setShowGuardianLink(false);
                      Alert.alert(
                        'Guardian Created', 
                        `An account was created for ${email}. Please share their temporary password with them:\n\n${defaultPassword}`
                      );
                    } catch (createErr: any) {
                      Alert.alert('Invite Failed', createErr.message || 'Could not auto-create guardian account.');
                    }
                  } else {
                    Alert.alert('Invite Failed', error.message || 'Could not link guardian.');
                  }
                }
              }}
              loading={inviteMut.isPending || linkGuardianMut.isPending || createAndInviteMut.isPending}
            />
          ) : (
            <Text style={{ color: colors.inkMuted }}>
              No email on file. Edit player profile to add a guardian email first.
            </Text>
          )}
          <Button label="Cancel" variant="ghost" onPress={() => setShowGuardianLink(false)} />
        </View>
      </Modal>

    </Screen>
  );
}
