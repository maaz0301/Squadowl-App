import { useTerms } from '@/lib/terms';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
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
  LETTER_KIND_LABELS,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
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
import { TemplateEditor, type TemplateDraft } from '@/components/letters/TemplateEditor';

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
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
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
  // Brief confirmation once a template is saved: the editor closes on success,
  // which on its own reads the same as it closing because something went wrong.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [savedNotice]);
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

  const letters = lettersQuery.data ?? [];
  // Memoized: this was rebuilt (with array-spread allocations) on every
  // keystroke in the player search box even though `letters` hadn't changed,
  // which is exactly what made a big roster feel laggy to filter.
  const lettersByPlayer = useMemo(() => {
    const map = new Map<string, PlayerLetter[]>();
    for (const l of letters) {
      const existing = map.get(l.playerId);
      if (existing) existing.push(l);
      else map.set(l.playerId, [l]);
    }
    return map;
  }, [letters]);

  const togglePlayer = useCallback((playerId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  // O(1) lookup for "which player sent this letter" instead of an O(n) find
  // per letter — with a big roster and letter history that loop reran on
  // every render (e.g. every checkbox tap above, since it shares this
  // component's state) and added up fast.
  const rosterById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of tryout?.roster ?? []) map.set(p.id, p);
    return map;
  }, [tryout?.roster]);

  const resendingId = resendLetter.isPending ? (resendLetter.variables as string) : null;

  const viewLetter = useCallback((l: PlayerLetter) => setOpenLetter(l), []);

  const resendLetterFor = useCallback(
    async (l: PlayerLetter) => {
      try {
        const updated = await resendLetter.mutateAsync(l.id);
        if (updated.status === 'failed') {
          Alert.alert('Not Sent', updated.error || 'The letter could not be sent.');
        }
      } catch (e: any) {
        Alert.alert('Send Failed', e?.message || 'Could not re-send.');
      }
    },
    [resendLetter],
  );

  const deleteLetterFor = useCallback(
    (l: PlayerLetter) => {
      Alert.alert(
        'Delete this copy?',
        terms.t("The record comes off the player's card. It does not recall an email already delivered."),
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
    },
    [deleteLetter],
  );

  const goBack = () => navigation.navigate('AssessmentRoster');

  if (tryoutQuery.isLoading) return <LoadingState message="Loading letters..." />;
  if (tryoutQuery.isError || !tryout) {
    return (
      <Screen padded>
        <Header title={terms.t('Player Selection Letters')} showBack onBack={goBack} />
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
        <Header title={terms.t('Player Selection Letters')} showBack onBack={goBack} />
        <EmptyState
          title="Coach tool"
          message="Selection letters are managed by the coach running this evaluation."
        />
      </Screen>
    );
  }

  const templates = templatesQuery.data ?? [];

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
      setSavedNotice('Template saved');
    } catch (e: any) {
      Alert.alert('Save Error', e?.message || 'Could not save the template.');
    }
  };

  const removeTemplate = (t: LetterTemplate) => {
    Alert.alert(
      'Delete template?',
      // Worth saying out loud: the copies are snapshots, so deleting the
      // stationery does not un-send anything.
      terms.t(`"${t.name}" will be removed. Letters already sent from it stay on the players' cards.`),
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
        ? terms.t(`${missingAddress.length} selected player${missingAddress.length === 1 ? ' has' : 's have'} no email address on file and will be saved as failed.`)
        : null,
    ].filter(Boolean) as string[];

    Alert.alert(
      terms.t(`Send to ${chosen.length} player${chosen.length === 1 ? '' : 's'}?`),
      [
        terms.t(`"${sendWith.name}" will be emailed to the guardian on file for each selected player, and a copy attached to their card.`),
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
        title={terms.t('Player Selection Letters')}
        subtitle={terms.t('Write an offer or roster decision letter once, then send it to the players you choose')}
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

      {savedNotice ? (
        <View
          className="mb-3 flex-row items-center gap-2 self-start rounded-full px-3 py-1.5"
          style={{ backgroundColor: 'rgba(34,197,94,0.16)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.45)' }}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-sm font-bold" style={{ color: colors.success }}>
            ✓
          </Text>
          <Text className="text-sm font-bold" style={{ color: colors.success }}>
            {savedNotice}
          </Text>
        </View>
      ) : null}

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
            No templates yet. Start from one of the standard letters, you can edit every word of it
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
                  label={sendWith?.id === t.id ? 'Selected' : terms.t('Select Players')}
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
                  : terms.t(`Send to ${selectedIds.size} Player${selectedIds.size === 1 ? '' : 's'}`)
              }
              size="sm"
              disabled={selectedIds.size === 0}
              loading={sendLetters.isPending}
              onPress={send}
            />
          </View>

          <Input value={playerSearch} onChangeText={setPlayerSearch} placeholder={terms.t('Search players by name')} />

          {filteredRoster.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No players match.
            </Text>
          ) : (
            // Bounded + windowed so this scrolls (and renders) on its own
            // regardless of roster size, instead of the page's ScrollView
            // mounting every row up front — that's what made opening this
            // list feel slow on a big roster.
            <FlatList
              data={filteredRoster}
              keyExtractor={(p) => p.id}
              style={{ maxHeight: 420 }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              renderItem={({ item }) => (
                <LetterPlayerRow
                  player={item}
                  selected={selectedIds.has(item.id)}
                  sentCount={lettersByPlayer.get(item.id)?.length ?? 0}
                  onToggle={togglePlayer}
                  onPreview={setPreviewFor}
                />
              )}
            />
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
          message={terms.t("Pick a template above, choose the players it applies to, and send. Every copy shows up here and on the player's card.")}
        />
      ) : (
        <View className="gap-2">
          {letters.map((l) => (
            <SentLetterRow
              key={l.id}
              letter={l}
              player={rosterById.get(l.playerId)}
              resending={resendingId === l.id}
              onView={viewLetter}
              onResend={resendLetterFor}
              onDelete={deleteLetterFor}
            />
          ))}
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
        title={previewFor ? `Preview: ${playerDisplayName(previewFor)}` : 'Preview'}
        onClose={() => setPreviewFor(null)}
      >
        {previewFor && sendWith ? (
          <LetterBody
            subject={renderFor(previewFor, sendWith.subject)}
            body={renderFor(previewFor, sendWith.body)}
            to={letterRecipient(previewFor)}
            noEmail={terms.t('No email address on file for this player')}
          />
        ) : null}
      </Modal>

      <Modal visible={!!openLetter} title={openLetter?.subject || 'Letter'} onClose={() => setOpenLetter(null)}>
        {openLetter ? (
          <LetterBody
            subject={openLetter.subject}
            body={openLetter.body}
            to={openLetter.recipientEmail}
            noEmail={terms.t('No email address on file for this player')}
          />
        ) : null}
      </Modal>
    </Screen>
  );
}

/**
 * One player row in the send-picker. Memoised, and taking primitives
 * (`selected`, `sentCount`) rather than derived objects, so toggling one
 * player — or typing in the search box — doesn't re-render every other row.
 */
const LetterPlayerRow = memo(function LetterPlayerRow({
  player,
  selected,
  sentCount,
  onToggle,
  onPreview,
}: {
  player: Player;
  selected: boolean;
  sentCount: number;
  onToggle: (playerId: string) => void;
  onPreview: (player: Player) => void;
}) {
  const colors = useThemeColors();
  const to = letterRecipient(player);
  return (
    <View
      className="flex-row items-center gap-2 rounded-2xl border p-3"
      style={{
        backgroundColor: colors.card,
        borderColor: selected ? colors.primary : colors.border,
      }}
    >
      <Pressable
        onPress={() => onToggle(player.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={playerDisplayName(player)}
        className="flex-1 flex-row items-center gap-3"
      >
        <View
          className="h-5 w-5 items-center justify-center rounded-[6px] border"
          style={{
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary : 'transparent',
          }}
        >
          {selected ? <Text className="text-xs font-bold text-white">✓</Text> : null}
        </View>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-sm font-bold" style={{ color: colors.ink }}>
            {playerDisplayName(player)}
          </Text>
          <Text numberOfLines={1} className="text-xs" style={{ color: to ? colors.inkMuted : colors.warning }}>
            {to ?? 'No email on file'}
          </Text>
        </View>
      </Pressable>
      {sentCount ? <Badge label={`${sentCount} sent`} variant="info" /> : null}
      <Button label="Preview" variant="ghost" size="sm" onPress={() => onPreview(player)} />
    </View>
  );
});

/**
 * One row in the sent-letters history. Memoised so it doesn't reconcile on
 * every unrelated state change in the screen (e.g. toggling a checkbox in
 * the player picker above, which lives in the same component's state).
 */
const SentLetterRow = memo(function SentLetterRow({
  letter: l,
  player,
  resending,
  onView,
  onResend,
  onDelete,
}: {
  letter: PlayerLetter;
  player: Player | undefined;
  resending: boolean;
  onView: (l: PlayerLetter) => void;
  onResend: (l: PlayerLetter) => void;
  onDelete: (l: PlayerLetter) => void;
}) {
  const colors = useThemeColors();
  return (
    <Card className="gap-2">
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
        <Button label="View" variant="secondary" size="sm" onPress={() => onView(l)} />
        <Button
          label={l.status === 'sent' ? 'Re-send' : 'Retry'}
          variant="secondary"
          size="sm"
          loading={resending}
          onPress={() => onResend(l)}
        />
        <Button label="Delete" variant="ghost" size="sm" onPress={() => onDelete(l)} />
      </View>
    </Card>
  );
});

/** The rendered letter, as the family will read it. */
function LetterBody({ subject, body, to, noEmail }: { subject: string; body: string; to?: string; noEmail: string }) {
  const colors = useThemeColors();
  const leftover = unfilledTokens(`${subject}\n${body}`);
  return (
    <View className="gap-3">
      <View>
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          To
        </Text>
        <Text className="text-sm" style={{ color: to ? colors.ink : colors.warning }}>
          {to ?? noEmail}
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
