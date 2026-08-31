import { useState, useMemo, useEffect } from 'react';
import { Alert, Text, View, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions, useUser } from '@/state/authStore';
import { canUseFeature } from '@/data/plans';
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
  useResendInviteMutation,
  useCreateAndInviteMemberMutation,
  useOrgMembersQuery,
  useSeasonsQuery,
  useAddSeasonPlayerMutation,
  useUploadPlayerPhotoMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName, weightedOverall, getPlayerCategories, isGoaliePosition } from '@/data/rubrics';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { PlanGate } from '@/components/PlanGate';

export default function PlayerHubScreen() {
  const assessmentId = useAssessmentId();
  const route = useRoute<any>();
  const { playerId, from } = route.params || {};
  const backScreen = from === 'results' ? 'AssessmentResults' : 'AssessmentRoster';
  const id = assessmentId;
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);
  
  const linkGuardianMut = useLinkGuardianMutation();
  const inviteMut = useInviteMemberMutation();
  const resendInviteMut = useResendInviteMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();
  const { data: members = [] } = useOrgMembersQuery();
  
  const [showEdit, setShowEdit] = useState(false);
  const [showGuardianLink, setShowGuardianLink] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoadingText, setAiLoadingText] = useState('Generating...');

  useEffect(() => {
    if (!aiSummary.isPending) {
      setAiLoadingText('Generating...');
      return;
    }
    const texts = ['Gathering data...', 'Ranking evaluations...', 'Analyzing strengths...', 'Finalizing insight...'];
    let idx = 0;
    const int = setInterval(() => {
      idx = (idx + 1) % texts.length;
      setAiLoadingText(texts[idx]);
    }, 2500);
    return () => clearInterval(int);
  }, [aiSummary.isPending]);

  const player = tryoutQuery.data?.roster.find((p) => p.athleteId === playerId || p.id === playerId);

  const { canManageTeam } = usePermissions();
  const user = useUser();
  const canLinkGuardian = canUseFeature(user?.planTier ?? 'free', 'guardianPortal');

  const categories = useMemo(() => {
    if (!tryoutQuery.data || !player) return [];
    return getPlayerCategories(
      tryoutQuery.data.sport,
      player.pos,
      tryoutQuery.data.settings.customRubrics,
    );
  }, [tryoutQuery.data, player]);

  const weights = useMemo(() => {
    if (!tryoutQuery.data || !player) return {};
    return isGoaliePosition(player.pos)
      ? tryoutQuery.data.settings.goalieWeights
      : tryoutQuery.data.settings.skaterWeights;
  }, [tryoutQuery.data, player]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  if (!player) return <EmptyState title="Player not found" />;

  const evals = tryoutQuery.data.evals
    .filter((e) => e.playerId === playerId)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Screen scroll insideTabBar>
      <Header
        title={playerDisplayName(player)}
        showBack
        onBack={() => navigation.navigate(backScreen)}
      />
      <View className="items-center py-4 gap-2">
        <Avatar first={player.first} last={player.last} pos={player.pos} size={72} uri={player.avatarUrl} />
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          #{player.jersey ?? '—'} · {player.pos ?? '—'}
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
            <View className="flex-row items-center gap-2">
              <Badge label="Linked" variant="success" />
              {canManageTeam && player.guardianEmail && !canLinkGuardian && (
                <Button
                  label="Upgrade to Resend"
                  variant="secondary"
                  size="sm"
                  onPress={() => navigation.navigate('Upgrade')}
                />
              )}
              {canManageTeam && player.guardianEmail && canLinkGuardian && (
                <Button
                  label="Resend Invite"
                  variant="secondary"
                  size="sm"
                  onPress={async () => {
                    try {
                      await resendInviteMut.mutateAsync({ 
                        userId: player.linkedGuardianId!, 
                        email: player.guardianEmail!, 
                        role: 'guardian' 
                      });
                      Alert.alert('Invite Sent', `Resent invite to ${player.guardianEmail} with a new temporary password.`);
                    } catch (error: any) {
                      const msg = error.message || '';
                      if (
                        msg.includes('User not found') || 
                        msg.includes('not found') || 
                        msg.includes('Database error') ||
                        msg.includes('finding user')
                      ) {
                        Alert.alert(
                          'Invite Failed',
                          'This login account no longer exists. Would you like to unlink it and send a new invite?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Re-invite',
                              onPress: async () => {
                                try {
                                  // Re-create the account first and only re-point the athlete's
                                  // link once that succeeds — linkGuardianMut overwrites whatever
                                  // guardian_user_id was there before in a single UPDATE, so there's
                                  // no need to null it out first. Unlinking up front used to mean a
                                  // transient failure in the create step (this call has genuinely
                                  // raced with GoTrue's own duplicate-email check before) left the
                                  // athlete with no guardian link at all instead of just keeping the
                                  // old (still-broken) one until a retry succeeds.
                                  const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
                                  const name = player.guardianName || 'Guardian';
                                  
                                  const newMember = await createAndInviteMut.mutateAsync({
                                    email: player.guardianEmail!,
                                    password: defaultPassword,
                                    name,
                                    role: 'guardian'
                                  });

                                  await linkGuardianMut.mutateAsync({
                                    guardianId: newMember.userId!,
                                    tryoutId: id!,
                                    playerId: player.athleteId!,
                                  });
                                  
                                  Alert.alert(
                                    'Guardian Re-created', 
                                    `An account was created for ${player.guardianEmail} and an email was sent containing their temporary password:\n\n${defaultPassword}`
                                  );
                                } catch (createErr: any) {
                                  Alert.alert('Invite Failed', createErr.message || 'Could not re-create guardian account.');
                                }
                              }
                            }
                          ]
                        );
                      } else {
                        Alert.alert('Invite Failed', error.message || 'Could not resend invite.');
                      }
                    }
                  }}
                  loading={resendInviteMut.isPending}
                />
              )}
            </View>
          ) : canManageTeam && canLinkGuardian ? (
            <Button
              label="Link Account"
              variant="secondary"
              size="sm"
              onPress={() => setShowGuardianLink(true)}
            />
          ) : canManageTeam ? (
            <Button
              label="Upgrade to Link"
              variant="secondary"
              size="sm"
              onPress={() => navigation.navigate('Upgrade')}
            />
          ) : (
            <Text style={{ color: colors.inkMuted }}>Not linked</Text>
          )}
        </View>

        {player.guardianName || player.guardianEmail ? (
          <>
            {player.guardianName ? (
              <Text style={{ color: colors.ink }}>{player.guardianName}</Text>
            ) : null}
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

        <PlanGate feature="aiSummaries" title="Deep AI Insights">
          {tryoutQuery.data.aiAssessments?.[playerId!] ? (
            <View className="mt-2 border-t pt-2" style={{ borderColor: colors.border }}>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="font-bold" style={{ color: colors.primary }}>AI Advanced Analysis</Text>
                <Button
                  label={aiSummary.isPending ? 'Processing...' : '↻ Regenerate'}
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    try {
                      await aiSummary.mutateAsync(playerId!);
                      setAiError(null);
                    } catch (error: any) {
                      setAiError(error.message || 'Failed to regenerate AI summary');
                    }
                  }}
                  loading={aiSummary.isPending}
                />
              </View>
              {aiSummary.isPending ? (
                <View className="items-center p-4">
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text className="mt-2 text-center" style={{ color: colors.ink }}>
                    {aiLoadingText}
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={{ color: colors.ink }}>
                    {tryoutQuery.data.aiAssessments[playerId!].summary}
                  </Text>
                  {tryoutQuery.data.aiAssessments[playerId!].key_strengths?.map((s: string) => (
                    <Text key={s} className="text-sm mt-1" style={{ color: colors.success }}>+ {s}</Text>
                  ))}
                  {tryoutQuery.data.aiAssessments[playerId!].key_growth?.map((s: string) => (
                    <Text key={s} className="text-sm mt-1" style={{ color: colors.primary }}>- {s}</Text>
                  ))}
                </>
              )}
              {aiError && (
                <View className="mt-3 p-3 rounded-md" style={{ backgroundColor: colors.tile }}>
                  <Text style={{ color: colors.ink, fontWeight: 'bold' }}>Notice</Text>
                  <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
                    {aiError.toLowerCase().includes('key') || aiError.toLowerCase().includes('developed') 
                      ? "This feature relies on an API key that is currently missing or in development. It will be built out soon."
                      : aiError}
                  </Text>
                  <Button 
                    label="Retry" 
                    size="sm" 
                    variant="secondary" 
                    className="mt-2"
                    onPress={() => {
                      setAiError(null);
                      aiSummary.mutate(playerId!);
                    }} 
                  />
                </View>
              )}
            </View>
          ) : (
            <>
              {aiSummary.isPending ? (
                <View className="items-center p-4">
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text className="mt-2 text-center" style={{ color: colors.ink }}>
                    {aiLoadingText}
                  </Text>
                </View>
              ) : (
                <Button
                  label="Generate AI Deep Dive"
                  size="sm"
                  className="mt-2"
                  onPress={async () => {
                    try {
                      await aiSummary.mutateAsync(playerId!);
                      setAiError(null);
                    } catch (error: any) {
                      setAiError(error.message || 'Failed to generate AI summary');
                    }
                  }}
                  loading={aiSummary.isPending}
                />
              )}
              {aiError && (
                <View className="mt-3 p-3 rounded-md" style={{ backgroundColor: colors.tile }}>
                  <Text style={{ color: colors.ink, fontWeight: 'bold' }}>Notice</Text>
                  <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
                    {aiError.toLowerCase().includes('key') || aiError.toLowerCase().includes('developed') 
                      ? "This feature relies on an API key that is currently missing or in development. It will be built out soon."
                      : aiError}
                  </Text>
                  <Button 
                    label="Retry" 
                    size="sm" 
                    variant="secondary" 
                    className="mt-2"
                    onPress={() => {
                      setAiError(null);
                      aiSummary.mutate(playerId!);
                    }} 
                  />
                </View>
              )}
            </>
          )}
        </PlanGate>

      </Card>

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Player Profile
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          View full evaluation history, score trends, and season-over-season comparison.
        </Text>
        <Button
          label="View Full Profile"
          variant="secondary"
          disabled={!player.athleteId}
          onPress={() => navigation.navigate('PlayerProfile', { athleteId: player.athleteId })}
        />
      </Card>

      <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
        Evaluations ({evals.length})
      </Text>
      {evals.length === 0 ? (
        <EmptyState title="No evaluations yet" message="Tap Score Player to add the first evaluation." />
      ) : (
        evals.map((ev) => {
          const overall = weightedOverall(ev.scores ?? {}, categories, weights);
          return (
            <Card key={ev.id} className="mb-2 gap-1">
              <View className="flex-row justify-between">
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {ev.session} · {ev.date} {overall > 0 ? `· Score: ${overall.toFixed(1)}` : ''}
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
        );
      })
      )}

      {canManageTeam && (
        <Button
          label="Delete Player"
          variant="danger"
          className="mt-6"
          loading={deletePlayer.isPending}
          onPress={() => {
            Alert.alert(
              'Delete Player',
              'Are you sure you want to delete this player? This cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await deletePlayer.mutateAsync(playerId!);
                    navigation.goBack();
                  },
                },
              ]
            );
          }}
        />
      )}

      <Modal visible={showEdit} title="Edit Player" onClose={() => setShowEdit(false)}>
        <AddPlayerForm
          defaultValues={player}
          loading={updatePlayer.isPending || uploadPhoto.isPending}
          onSubmit={async (data) => {
            try {
              if (player.athleteId && data.avatarUrl && data.avatarUrl.startsWith('file://')) {
                try {
                  const publicUrl = await uploadPhoto.mutateAsync({
                    athleteId: player.athleteId,
                    fileUri: data.avatarUrl,
                    fileType: 'image/jpeg',
                  });
                  data.avatarUrl = publicUrl;
                } catch (e: any) {
                  Alert.alert('Upload Error', 'Failed to upload profile picture: ' + e.message);
                }
              }
              await updatePlayer.mutateAsync({ playerId: playerId!, updates: data });
              setShowEdit(false);
            } catch (err: any) {
              Alert.alert('Save Error', 'Failed to update player: ' + err.message);
            }
          }}
        />
      </Modal>

      <Modal visible={showGuardianLink} title="Link Guardian" onClose={() => setShowGuardianLink(false)}>
        <View className="gap-3">
          <Text style={{ color: colors.ink }}>
            Link {player.first} to a guardian account to grant them portal access.
          </Text>
          {player.guardianEmail ? (
            <View className="gap-2">
              {player.linkedGuardianId && (
                <Text style={{ color: colors.inkMuted }} className="text-sm mb-1">
                  This guardian is already linked. Sending a new invite will refresh their access.
                </Text>
              )}
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
                    Alert.alert('Success', 'Guardian account linked and invitation sent successfully.');
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
                          `An account was created for ${email} and an email was sent to them containing their temporary password:\n\n${defaultPassword}`
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
            </View>
          ) : (
            <Text style={{ color: colors.inkMuted }}>
              No email on file. Edit player profile to add a guardian email first.
            </Text>
          )}
        </View>
      </Modal>

    </Screen>
  );
}
