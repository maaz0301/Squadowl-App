import { useState, useMemo, useEffect } from 'react';
import { Alert, Text, View, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions, useUser } from '@/state/authStore';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { canUseFeature } from '@/data/plans';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Input,
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
  useSeasonsQuery,
  useAddSeasonPlayerMutation,
  useUploadPlayerPhotoMutation,
  useFamilyContactsQuery,
  useAddFamilyContactMutation,
  useRemoveFamilyContactMutation,
  usePlayerLettersForParticipantQuery,
  useResendPlayerLetterMutation,
  usePlatformBlockedFeaturesQuery,
} from '@/features/queries';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { playerDisplayName, weightedOverall, getPlayerCategories, isGoaliePosition } from '@/data/rubrics';
import { LETTER_KIND_LABELS } from '@/data/letters';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { PlanGate } from '@/components/PlanGate';

export default function PlayerHubScreen() {
  const assessmentId = useAssessmentId();
  const isAssessorOnly = useAssessorMode();
  const route = useRoute<any>();
  const { playerId, from } = route.params || {};
  const backScreen = from === 'results' ? 'AssessmentResults' : 'AssessmentRoster';
  const id = assessmentId;
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);
  
  const linkGuardianMut = useLinkGuardianMutation();
  const inviteMut = useInviteMemberMutation();
  const resendInviteMut = useResendInviteMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();
  
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

  const { canManageTeam, canAssess } = usePermissions();
  const user = useUser();
  const canLinkGuardian = canUseFeature(effectiveTier, 'guardianPortal');
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');

  // Extra family members beyond the one guardian on the athlete row — added
  // here or from the Edit Player form, and by the guardian themselves from
  // their own portal. This card is what surfaces them to the coach at all.
  const familyContactsQuery = useFamilyContactsQuery(player?.athleteId);
  const addFamilyContactMut = useAddFamilyContactMutation(player?.athleteId ?? '');
  const removeFamilyContactMut = useRemoveFamilyContactMutation(player?.athleteId ?? '');
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Letters sent to this player from the Letters tool — composing a new one
  // lives there (it needs the template picker across the whole roster), so
  // this card is a read-only history plus the re-send/retry a coach reaches
  // for right from the player they're looking at.
  // Coach only, matching the Letters tool itself — an invited assessor scores
  // and edits the roster but doesn't decide who made the team.
  const isCoachHere = canManageTeam && !isAssessorOnly;
  // Scoped server-side to this one player (player?.id, the tryout_participants
  // row — not the URL's playerId param, which can be the athleteId instead;
  // see the lookup above) instead of fetching every letter in the assessment
  // and filtering client-side.
  const playerLettersQuery = usePlayerLettersForParticipantQuery(id, player?.id);
  const resendLetterMut = useResendPlayerLetterMutation(id!);
  const playerLetters = (playerLettersQuery.data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);

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

  const submitFamilyContact = async () => {
    if (!contactName.trim()) {
      Alert.alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addFamilyContactMut.mutateAsync({
        name: contactName.trim(),
        relationship: contactRelationship.trim() || undefined,
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
      });
      setContactName('');
      setContactRelationship('');
      setContactEmail('');
      setContactPhone('');
      setShowAddContact(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not add this contact.');
    }
  };

  const confirmRemoveContact = (contactId: string, name: string) => {
    Alert.alert(
      'Remove Contact',
      `Remove ${name} from this athlete's family contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFamilyContactMut.mutateAsync(contactId);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not remove this contact.');
            }
          },
        },
      ]
    );
  };

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
        {player.playerEmail ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>{player.playerEmail}</Text>
        ) : null}
      </View>

        <View className="flex-row items-center gap-2 mt-4 mb-6">
          <Button
            label="Score Player"
            className="flex-1"
            onPress={() =>
              navigation.navigate('AssessmentFlow', {
                screen: 'AssessmentScore',
                params: { id: id, playerId: playerId, isAssessorOnly },
              })
            }
          />
          {/* Edit is open to anyone who can assess — including an invited
              assessor — since fixing a wrong jersey number or position
              shouldn't need the owning coach; Delete stays coach/admin-only. */}
          {canAssess && <Button label="Edit" variant="secondary" className="flex-1" onPress={() => setShowEdit(true)} />}
        </View>

      <Card className="mb-4 gap-1">
        <View className="flex-row justify-between items-center mb-1">
          <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
            Guardian Access
          </Text>
          {player.linkedGuardianId ? (
            <View className="flex-row items-center gap-2">
              <Badge label="Linked" variant="success" />
              {canManageTeam && player.guardianEmail && !canLinkGuardian && !billingBlocked && (
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
          ) : canManageTeam && !billingBlocked ? (
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

      {/* Open to anyone who can assess — including an invited assessor — so
          they can see and correct the same family contacts a coach can. */}
      {player.athleteId && canAssess ? (
        <Card className="mb-4 gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
              Family Contacts
            </Text>
            <Button label="+ Add" size="sm" variant="ghost" onPress={() => setShowAddContact(true)} />
          </View>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            A second parent, a grandparent, or anyone else who should get invites for this player.
          </Text>
          {familyContactsQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (familyContactsQuery.data ?? []).length === 0 ? (
            <Text style={{ color: colors.inkFaint }}>No additional contacts added yet.</Text>
          ) : (
            <View className="gap-2">
              {(familyContactsQuery.data ?? []).map((c) => (
                <View
                  key={c.id}
                  className="flex-row items-center justify-between gap-2 border-b pb-2"
                  style={{ borderColor: colors.border }}
                >
                  <View className="flex-1">
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {c.name}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </Text>
                    {c.email ? <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.email}</Text> : null}
                    {c.phone ? <Text className="text-xs" style={{ color: colors.inkMuted }}>{c.phone}</Text> : null}
                  </View>
                  <Button
                    label="Remove"
                    variant="ghost"
                    size="sm"
                    onPress={() => confirmRemoveContact(c.id, c.name)}
                    loading={removeFamilyContactMut.isPending && removeFamilyContactMut.variables === c.id}
                  />
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : null}

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

      {/* The profile is season-over-season history, which an assessor
          scores without — they only ever see the assessment in front of
          them. */}
      {isAssessorOnly ? null : (
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
      )}

      {/* Evaluations (session scores) are for managers/owners. An assessor
          already gets session numbering on Score via session progress, and
          those prior sessions stay disabled there — they must not read others'
          scores here. */}
      {isAssessorOnly ? null : (
        <>
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
                      navigation.navigate('AssessmentFlow', {
                        screen: 'AssessmentScore',
                        params: { id, playerId, evalId: ev.id },
                      })
                    }
                  />
                </Card>
              );
            })
          )}
        </>
      )}

      {isCoachHere ? (
        <Card className="mb-4 gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Letters
            </Text>
            <Button
              label="Send a Letter"
              size="sm"
              variant="ghost"
              onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentLetters', params: { id: id, isAssessorOnly } })}
            />
          </View>
          {playerLettersQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : playerLetters.length === 0 ? (
            <Text style={{ color: colors.inkFaint }}>
              No offer or roster decision letters sent to this player yet.
            </Text>
          ) : (
            <View className="gap-2">
              {playerLetters.map((l) => (
                <View
                  key={l.id}
                  className="flex-row items-start justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                  style={{ borderColor: colors.border }}
                >
                  <View className="min-w-0 flex-1">
                    <View className="flex-row flex-wrap items-center gap-1.5">
                      <Text numberOfLines={1} className="font-bold" style={{ color: colors.ink }}>
                        {l.subject}
                      </Text>
                      <Badge
                        label={l.status}
                        variant={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : 'warning'}
                      />
                    </View>
                    <Text numberOfLines={1} className="text-xs" style={{ color: colors.inkMuted }}>
                      {LETTER_KIND_LABELS[l.kind]}
                      {l.recipientEmail ? ` · ${l.recipientEmail}` : ''}
                      {l.sentAt ? ` · ${new Date(l.sentAt).toLocaleDateString()}` : ''}
                    </Text>
                    {l.status === 'failed' && l.error ? (
                      <Text className="mt-0.5 text-xs" style={{ color: colors.danger }}>
                        {l.error}
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    label={l.status === 'sent' ? 'Re-send' : 'Retry'}
                    variant="ghost"
                    size="sm"
                    loading={resendLetterMut.isPending && resendLetterMut.variables === l.id}
                    onPress={async () => {
                      try {
                        const updated = await resendLetterMut.mutateAsync(l.id);
                        if (updated.status === 'failed') {
                          Alert.alert('Not Sent', updated.error || 'The letter could not be sent.');
                        }
                      } catch (e: any) {
                        Alert.alert('Send Failed', e?.message || 'Could not re-send.');
                      }
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        </Card>
      ) : null}

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
          sport={tryoutQuery.data.sport}
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

      <Modal
        visible={showAddContact}
        title="Add Family Member"
        onClose={() => {
          if (addFamilyContactMut.isPending) return;
          setShowAddContact(false);
        }}
      >
        <View className="gap-3">
          <Input label="Name" value={contactName} onChangeText={setContactName} />
          <Input
            label="Relationship"
            value={contactRelationship}
            onChangeText={setContactRelationship}
            placeholder="e.g. Grandmother, Emergency Contact"
          />
          <Input
            label="Email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={contactEmail}
            onChangeText={setContactEmail}
          />
          <Input label="Phone" value={contactPhone} onChangeText={setContactPhone} />
          <Button
            label="Add Contact"
            onPress={submitFamilyContact}
            loading={addFamilyContactMut.isPending}
            disabled={!contactName.trim()}
          />
        </View>
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
