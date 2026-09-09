import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
} from '@/components/ui';
import {
  BUILT_IN_LETTER_TEMPLATES,
  LETTER_KINDS,
  LETTER_KIND_DESCRIPTIONS,
  LETTER_KIND_LABELS,
  LETTER_PLACEHOLDERS,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
  type LetterKind,
} from '@/data/letters';
import { playerDisplayName } from '@/data/rubrics';
import type { LetterTemplate, Player, PlayerLetter } from '@/data/types';
import {
  useCreateLetterTemplateMutation,
  useDeleteLetterTemplateMutation,
  useDeletePlayerLetterMutation,
  useLetterTemplatesQuery,
  usePlayerLettersQuery,
  useResendPlayerLetterMutation,
  useSendPlayerLettersMutation,
  useTeamsQuery,
  useTryoutQuery,
  useUpdateLetterTemplateMutation,
} from '@/features/queries';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';

/** The template editor's working copy — a new template until it has an id. */
interface TemplateDraft {
  id?: string;
  name: string;
  kind: LetterKind;
  subject: string;
  body: string;
}

const STATUS_VARIANT = { sent: 'success', failed: 'danger', draft: 'warning' } as const;

/**
 * Player Selection Letters: create/edit/delete reusable letter templates
 * (offer, roster decision, custom), pick players from the roster, preview the
 * rendered letter per player, send in bulk, and re-send/edit/delete what's
 * already gone out. Reached from Roster -> Tools -> "Player Selection
 * Letters" — see roster.tsx.
 *
 * Ported from the web app's assessment/[id]/letters screen. The template
 * model and token substitution (src/data/letters.ts) are kept exactly the
 * same; the UI is rebuilt with this app's own components instead of a literal
 * JSX translation.
 */
export default function LettersScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const isAssessorOnly = useAssessorMode();
  const user = useUser();

  const tryoutQuery = useTryoutQuery(id);
  const teamsQuery = useTeamsQuery();
  const templatesQuery = useLetterTemplatesQuery();
  const lettersQuery = usePlayerLettersQuery(id);

  const createTemplate = useCreateLetterTemplateMutation();
  const updateTemplate = useUpdateLetterTemplateMutation();
  const deleteTemplate = useDeleteLetterTemplateMutation();
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);
  const sendLetters = useSendPlayerLettersMutation(id!, (done, total) => setSendProgress({ done, total }));
  const resendLetter = useResendPlayerLetterMutation(id!);
  const deleteLetter = useDeletePlayerLetterMutation(id!);

  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [sendWith, setSendWith] = useState<LetterTemplate | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState('');
  const [previewFor, setPreviewFor] = useState<Player | null>(null);
  const [openLetter, setOpenLetter] = useState<PlayerLetter | null>(null);

  const tryout = tryoutQuery.data;
  const team = useMemo(
    () => teamsQuery.data?.find((t) => t.id === tryout?.teamId),
    [teamsQuery.data, tryout?.teamId],
  );

  // The context every letter is rendered against. The coach's own identity
  // stands in wherever the assessment does not name a head coach — a letter
  // signed by nobody is worse than one signed by the person sending it.
  const letterContext = useMemo(
    () => ({
      teamName: team?.name || tryout?.name,
      // Teams carry the season as free text; failing that, the year the
      // assessment was actually run is the closest true thing we hold.
      seasonName: team?.season || tryout?.tryoutDate?.slice(0, 4),
      coachName: tryout?.headCoach || tryout?.headAssessor || user?.displayName,
      coachEmail: tryout?.headAssessorEmail || user?.email,
    }),
    [team, tryout, user],
  );

  const renderFor = (player: Player, text: string) =>
    renderLetter(
      text,
      buildLetterVars({
        playerFirst: player.first,
        playerLast: player.last,
        guardianName: player.guardianName,
        ...letterContext,
      }),
    );

  const filteredRoster = useMemo(() => {
    const roster = tryout?.roster ?? [];
    const search = playerSearch.trim().toLowerCase();
    if (!search) return roster;
    return roster.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(search));
  }, [tryout?.roster, playerSearch]);

  const goBack = () => navigation.navigate('AssessmentRoster');

  if (tryoutQuery.isLoading) return <LoadingState message="Loading letters..." />;
  if (tryoutQuery.isError || !tryout) {
    return (
      <Screen padded>
        <Header title="Player Selection Letters" showBack onBack={goBack} />
        <ErrorState message="Could not load this evaluation." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  // Letters are a coach decision, not a scoring one — an invited assessor
  // scores and edits the roster but doesn't decide who made the team, and
  // shouldn't be mailing families on the coach's behalf.
  if (isAssessorOnly) {
    return (
      <Screen padded>
        <Header title="Player Selection Letters" showBack onBack={goBack} />
        <EmptyState
          title="Coach tool"
          message="Selection letters are managed by the coach running this evaluation."
        />
      </Screen>
    );
  }

  const templates = templatesQuery.data ?? [];
  const letters = lettersQuery.data ?? [];
  const lettersByPlayer = new Map<string, PlayerLetter[]>();
  for (const l of letters) {
    lettersByPlayer.set(l.playerId, [...(lettersByPlayer.get(l.playerId) ?? []), l]);
  }

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Give the template a name so you can find it again.');
      return;
    }
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          updates: { name: draft.name, kind: draft.kind, subject: draft.subject, body: draft.body },
        });
      } else {
        await createTemplate.mutateAsync({
          name: draft.name,
          kind: draft.kind,
          subject: draft.subject,
          body: draft.body,
          tryoutId: id,
        });
      }
      setDraft(null);
    } catch (e: any) {
      Alert.alert('Save Error', e?.message || 'Could not save the template.');
    }
  };

  const removeTemplate = (t: LetterTemplate) => {
    Alert.alert(
      'Delete template?',
      // Worth saying out loud: the copies are snapshots, so deleting the
      // stationery does not un-send anything.
      `"${t.name}" will be removed. Letters already sent from it stay on the players' cards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTemplate.mutateAsync(t.id);
              if (sendWith?.id === t.id) setSendWith(null);
            } catch (e: any) {
              Alert.alert('Delete Failed', e?.message || 'Could not delete the template.');
            }
          },
        },
      ],
    );
  };

  const startSend = (t: LetterTemplate) => {
    setSendWith(t);
    setSelectedIds(new Set());
    setPlayerSearch('');
  };

  const togglePlayer = (playerId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });

  const send = () => {
    if (!sendWith) return;
    const chosen = tryout.roster.filter((p) => selectedIds.has(p.id));
    if (!chosen.length) return;

    const missingAddress = chosen.filter((p) => !letterRecipient(p));
    // Checked on the rendered body, not the template: {{player_name}} is
    // supposed to still be a token here, and only what survives rendering is
    // something a family would actually read.
    const leftover = unfilledTokens(
      `${renderFor(chosen[0], sendWith.subject)}\n${renderFor(chosen[0], sendWith.body)}`,
    );

    const warnings = [
      leftover.length
        ? `${leftover.map((t) => `{{${t}}}`).join(', ')} ${leftover.length === 1 ? 'has' : 'have'} not been filled in and will be sent as-is.`
        : null,
      missingAddress.length
        ? `${missingAddress.length} selected player${missingAddress.length === 1 ? ' has' : 's have'} no email address on file and will be saved as failed.`
        : null,
    ].filter(Boolean) as string[];

    Alert.alert(
      `Send to ${chosen.length} player${chosen.length === 1 ? '' : 's'}?`,
      [
        `"${sendWith.name}" will be emailed to the guardian on file for each selected player, and a copy attached to their card.`,
        ...warnings,
      ].join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSendProgress({ done: 0, total: chosen.length });
            try {
              const results = await sendLetters.mutateAsync(
                chosen.map((p) => ({
                  playerId: p.id,
                  playerName: playerDisplayName(p),
                  athleteId: p.athleteId,
                  templateId: sendWith.id,
                  kind: sendWith.kind,
                  subject: renderFor(p, sendWith.subject),
                  body: renderFor(p, sendWith.body),
                  recipientEmail: letterRecipient(p),
                })),
              );
              const failed = results.filter((r) => r.error);
              Alert.alert(
                failed.length ? 'Sent with problems' : 'Letters sent',
                failed.length
                  ? `${results.length - failed.length} of ${results.length} sent. These did not go out:\n\n${failed
                      .map((r) => `${r.playerName}: ${r.error}`)
                      .join('\n')}`
                  : `${results.length} letter${results.length === 1 ? '' : 's'} sent.`,
              );
              setSelectedIds(new Set());
            } catch (e: any) {
              Alert.alert('Send Failed', e?.message || 'Could not send the letters.');
            } finally {
              setSendProgress(null);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen scroll insideTabBar>
      <Header
        title="Player Selection Letters"
        subtitle="Write an offer or roster decision letter once, then send it to the players you choose"
        showBack
        onBack={goBack}
        right={
          <Button
            label="+ New"
            size="sm"
            onPress={() => setDraft({ name: '', kind: 'custom', subject: '', body: '' })}
          />
        }
      />

      <Text className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Templates
      </Text>
      {templatesQuery.isLoading ? (
        <LoadingState message="Loading templates..." />
      ) : templatesQuery.isError ? (
        <ErrorState message="Could not load your templates." onRetry={() => templatesQuery.refetch()} />
      ) : templates.length === 0 ? (
        <Card className="mb-6 gap-3">
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            No templates yet. Start from one of the standard letters — you can edit every word of it
            before anything is sent.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {BUILT_IN_LETTER_TEMPLATES.map((t) => (
              <Button
                key={t.kind}
                label={`Start from ${LETTER_KIND_LABELS[t.kind]}`}
                variant="secondary"
                size="sm"
                onPress={() => setDraft({ name: t.name, kind: t.kind, subject: t.subject, body: t.body })}
              />
            ))}
          </View>
        </Card>
      ) : (
        <View className="mb-6 gap-3">
          {templates.map((t) => (
            <Card key={t.id} accent={sendWith?.id === t.id} className="gap-2">
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-base font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </Text>
                  <Text numberOfLines={1} className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                    {t.subject || 'No subject'}
                  </Text>
                </View>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={sendWith?.id === t.id ? 'Selected' : 'Select Players'}
                  size="sm"
                  onPress={() => startSend(t)}
                />
                <Button
                  label="Edit"
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    setDraft({ id: t.id, name: t.name, kind: t.kind, subject: t.subject, body: t.body })
                  }
                />
                <Button label="Delete" variant="ghost" size="sm" onPress={() => removeTemplate(t)} />
              </View>
            </Card>
          ))}
        </View>
      )}

      {sendWith ? (
        <Card className="mb-6 gap-3">
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Send &ldquo;{sendWith.name}&rdquo;
              </Text>
              <Text className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                Goes to each player&rsquo;s guardian email, falling back to the player&rsquo;s own.
              </Text>
            </View>
            <Button label="Cancel" variant="ghost" size="sm" onPress={() => setSendWith(null)} />
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Button
              label={selectedIds.size === filteredRoster.length ? 'Deselect All' : 'Select All'}
              variant="secondary"
              size="sm"
              onPress={() =>
                setSelectedIds(
                  selectedIds.size === filteredRoster.length
                    ? new Set()
                    : new Set(filteredRoster.map((p) => p.id)),
                )
              }
            />
            <Button
              label={
                sendProgress
                  ? `Sending ${sendProgress.done}/${sendProgress.total}...`
                  : `Send to ${selectedIds.size} Player${selectedIds.size === 1 ? '' : 's'}`
              }
              size="sm"
              disabled={selectedIds.size === 0}
              loading={sendLetters.isPending}
              onPress={send}
            />
          </View>

          <Input value={playerSearch} onChangeText={setPlayerSearch} placeholder="Search players by name" />

          {filteredRoster.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No players match.
            </Text>
          ) : (
            <View className="gap-2">
              {filteredRoster.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const to = letterRecipient(p);
                const already = lettersByPlayer.get(p.id) ?? [];
                return (
                  <View
                    key={p.id}
                    className="flex-row items-center gap-2 rounded-2xl border p-3"
                    style={{
                      backgroundColor: colors.card,
                      borderColor: isSelected ? colors.primary : colors.border,
                    }}
                  >
                    <Pressable
                      onPress={() => togglePlayer(p.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={playerDisplayName(p)}
                      className="flex-1 flex-row items-center gap-3"
                    >
                      <View
                        className="h-5 w-5 items-center justify-center rounded-[6px] border"
                        style={{
                          borderColor: isSelected ? colors.primary : colors.border,
                          backgroundColor: isSelected ? colors.primary : 'transparent',
                        }}
                      >
                        {isSelected ? <Text className="text-xs font-bold text-white">✓</Text> : null}
                      </View>
                      <View className="flex-1">
                        <Text numberOfLines={1} className="text-sm font-bold" style={{ color: colors.ink }}>
                          {playerDisplayName(p)}
                        </Text>
                        <Text
                          numberOfLines={1}
                          className="text-xs"
                          style={{ color: to ? colors.inkMuted : colors.warning }}
                        >
                          {to ?? 'No email on file'}
                        </Text>
                      </View>
                    </Pressable>
                    {already.length ? <Badge label={`${already.length} sent`} variant="info" /> : null}
                    <Button label="Preview" variant="ghost" size="sm" onPress={() => setPreviewFor(p)} />
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      ) : null}

      <Text className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Sent Letters
      </Text>
      {lettersQuery.isLoading ? (
        <LoadingState message="Loading sent letters..." />
      ) : letters.length === 0 ? (
        <EmptyState
          title="No letters sent yet"
          message="Pick a template above, choose the players it applies to, and send. Every copy shows up here and on the player's card."
        />
      ) : (
        <View className="gap-2">
          {letters.map((l) => {
            const player = tryout.roster.find((p) => p.id === l.playerId);
            return (
              <Card key={l.id} className="gap-2">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text numberOfLines={1} className="text-base font-bold" style={{ color: colors.ink }}>
                      {player ? playerDisplayName(player) : 'Removed player'}
                    </Text>
                    <Text numberOfLines={1} className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                      {l.subject}
                    </Text>
                    <Text numberOfLines={1} className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                      {LETTER_KIND_LABELS[l.kind]}
                      {l.recipientEmail ? ` · ${l.recipientEmail}` : ''}
                      {l.sentAt ? ` · ${new Date(l.sentAt).toLocaleDateString()}` : ''}
                    </Text>
                    {l.status === 'failed' && l.error ? (
                      <Text className="mt-1 text-xs" style={{ color: colors.danger }}>
                        {l.error}
                      </Text>
                    ) : null}
                  </View>
                  <Badge label={l.status} variant={STATUS_VARIANT[l.status]} />
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <Button label="View" variant="secondary" size="sm" onPress={() => setOpenLetter(l)} />
                  <Button
                    label={l.status === 'sent' ? 'Re-send' : 'Retry'}
                    variant="secondary"
                    size="sm"
                    loading={resendLetter.isPending && resendLetter.variables === l.id}
                    onPress={async () => {
                      try {
                        const updated = await resendLetter.mutateAsync(l.id);
                        if (updated.status === 'failed') {
                          Alert.alert('Not Sent', updated.error || 'The letter could not be sent.');
                        }
                      } catch (e: any) {
                        Alert.alert('Send Failed', e?.message || 'Could not re-send.');
                      }
                    }}
                  />
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="sm"
                    onPress={() => {
                      Alert.alert(
                        'Delete this copy?',
                        "The record comes off the player's card. It does not recall an email already delivered.",
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await deleteLetter.mutateAsync(l.id);
                              } catch (e: any) {
                                Alert.alert('Delete Failed', e?.message || 'Could not delete.');
                              }
                            },
                          },
                        ],
                      );
                    }}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <TemplateEditor
        draft={draft}
        saving={createTemplate.isPending || updateTemplate.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
      />

      <Modal
        visible={!!previewFor && !!sendWith}
        title={previewFor ? `Preview — ${playerDisplayName(previewFor)}` : 'Preview'}
        onClose={() => setPreviewFor(null)}
      >
        {previewFor && sendWith ? (
          <LetterBody
            subject={renderFor(previewFor, sendWith.subject)}
            body={renderFor(previewFor, sendWith.body)}
            to={letterRecipient(previewFor)}
          />
        ) : null}
      </Modal>

      <Modal visible={!!openLetter} title={openLetter?.subject || 'Letter'} onClose={() => setOpenLetter(null)}>
        {openLetter ? (
          <LetterBody subject={openLetter.subject} body={openLetter.body} to={openLetter.recipientEmail} />
        ) : null}
      </Modal>
    </Screen>
  );
}

/** The rendered letter, as the family will read it. */
function LetterBody({ subject, body, to }: { subject: string; body: string; to?: string }) {
  const colors = useThemeColors();
  const leftover = unfilledTokens(`${subject}\n${body}`);
  return (
    <View className="gap-3">
      <View>
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          To
        </Text>
        <Text className="text-sm" style={{ color: to ? colors.ink : colors.warning }}>
          {to ?? 'No email address on file for this player'}
        </Text>
      </View>
      <View>
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          Subject
        </Text>
        <Text className="text-sm font-bold" style={{ color: colors.ink }}>
          {subject}
        </Text>
      </View>
      {leftover.length ? (
        <Text className="text-sm" style={{ color: colors.warning }}>
          Still unfilled: {leftover.map((t) => `{{${t}}}`).join(', ')}
        </Text>
      ) : null}
      <Text
        className="rounded-2xl p-4 text-sm leading-relaxed"
        style={{ backgroundColor: colors.tile, color: colors.ink }}
      >
        {body}
      </Text>
    </View>
  );
}

function TemplateEditor({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: TemplateDraft | null;
  saving: boolean;
  onChange: (d: TemplateDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={!!draft}
      title={draft?.id ? 'Edit Template' : 'New Template'}
      onClose={onClose}
      footer={<Button label="Save Template" loading={saving} onPress={onSave} />}
    >
      {draft ? (
        <View className="gap-3">
          <Input
            label="Template name"
            value={draft.name}
            onChangeText={(v) => onChange({ ...draft, name: v })}
            placeholder="e.g. U15 AAA Offer Letter"
          />
          <View className="gap-1">
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Type
            </Text>
            <View className="flex-row flex-wrap">
              {LETTER_KINDS.map((k) => (
                <Chip
                  key={k}
                  label={LETTER_KIND_LABELS[k]}
                  active={draft.kind === k}
                  onPress={() => onChange({ ...draft, kind: k })}
                />
              ))}
            </View>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {LETTER_KIND_DESCRIPTIONS[draft.kind]}
            </Text>
          </View>
          <Input label="Subject" value={draft.subject} onChangeText={(v) => onChange({ ...draft, subject: v })} />
          <Input
            label="Letter"
            value={draft.body}
            onChangeText={(v) => onChange({ ...draft, body: v })}
            multiline
            numberOfLines={12}
            style={{ minHeight: 220, textAlignVertical: 'top' }}
          />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Tap a placeholder below to add it to the end of the letter.
          </Text>

          {/* Only the standard letters carry pre-written wording, so offering
              them here is what makes "start from the template" reachable when a
              coach is already halfway through writing their own. */}
          {!draft.id ? (
            <View>
              <Text className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Start from a standard letter
              </Text>
              <View className="flex-row flex-wrap">
                {BUILT_IN_LETTER_TEMPLATES.map((t) => (
                  <Chip
                    key={t.kind}
                    label={LETTER_KIND_LABELS[t.kind]}
                    onPress={() =>
                      onChange({
                        ...draft,
                        name: draft.name || t.name,
                        kind: t.kind,
                        subject: t.subject,
                        body: t.body,
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <Text className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Placeholders
            </Text>
            <View className="gap-1">
              {LETTER_PLACEHOLDERS.map((p) => (
                <Pressable
                  key={p.token}
                  onPress={() => onChange({ ...draft, body: `${draft.body}{{${p.token}}}` })}
                  className="flex-row flex-wrap items-center gap-2 rounded-lg px-2 py-2 active:opacity-70"
                  style={{ backgroundColor: colors.tile }}
                >
                  <Text className="text-xs font-bold" style={{ color: colors.primary }}>{`{{${p.token}}}`}</Text>
                  <Text className="flex-1 text-xs" style={{ color: colors.inkMuted }}>
                    {p.hint}
                  </Text>
                  {!p.auto ? <Badge label="you write this" variant="warning" /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
