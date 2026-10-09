import { useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Screen,
  useTypeToConfirm,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useDeletePlayerReportCardMutation,
  useGenerateReportCardCommentsMutation,
  usePlayerReportCardsQuery,
  useSavePlayerReportCardMutation,
  useTeamsQuery,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { buildPlayerFullResults } from '@/data/resultsExport';
import { playerDisplayName } from '@/data/rubrics';
import type { PlayerReportCard, ReportCardAttachment } from '@/data/types';
import { DocumentPickerUnavailable, pickAttachment, type PickedAttachment } from '@/lib/documentPicker';
import { ContextVideos } from '@/components/video/ContextVideos';
import { formatAiComments } from '@/lib/reportCardText';
import { reportLogoUrls } from '@/lib/reportPdf';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { usePermissions, useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Only http(s) addresses are ever opened; anything else a coach typed is ignored. */
function safeExternalUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function notify(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function PlayerReportCardScreen() {
  const id = useAssessmentId();
  const isAssessorOnly = useAssessorMode();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId } = route.params || {};
  const colors = useThemeColors();
  const { canManageTeam } = usePermissions();
  const user = useUser();
  const typeToConfirm = useTypeToConfirm();

  const tryoutQuery = useTryoutQuery(id);
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const teamsQuery = useTeamsQuery();

  const player = tryoutQuery.data?.roster.find((p) => p.athleteId === playerId || p.id === playerId);
  const cardsQuery = usePlayerReportCardsQuery(player?.athleteId);
  const refreshControl = usePullToRefresh(() =>
    Promise.all([tryoutQuery.refetch(), cardsQuery.refetch(), teamsQuery.refetch()]),
  );
  const save = useSavePlayerReportCardMutation(player?.athleteId ?? '');
  const remove = useDeletePlayerReportCardMutation(player?.athleteId ?? '');
  const generate = useGenerateReportCardCommentsMutation(id!);

  const [editingId, setEditingId] = useState<string | undefined>();
  const [title, setTitle] = useState('Player Report Card');
  // null = "every evaluation", so a card opened before new evaluations were
  // scored picks them up until the coach makes an explicit choice.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [coachComments, setCoachComments] = useState('');
  const [aiComments, setAiComments] = useState('');
  const [kept, setKept] = useState<ReportCardAttachment[]>([]);
  const [files, setFiles] = useState<PickedAttachment[]>([]);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkIsVideo, setLinkIsVideo] = useState(false);
  const [exporting, setExporting] = useState(false);

  const tryout = tryoutQuery.data;
  const playerEvals = useMemo(
    () => (tryout && player ? tryout.evals.filter((e) => e.playerId === player.id).sort((a, b) => a.createdAt - b.createdAt) : []),
    [tryout, player],
  );
  const chosen = useMemo(() => new Set(selected ?? playerEvals.map((e) => e.id)), [selected, playerEvals]);

  // Scores for the evaluations chosen, worked out exactly as the results
  // report works them out, with only this player's evaluations narrowed down.
  const reportCard = useMemo(() => {
    if (!tryout || !player) return null;
    const scoped = { ...tryout, evals: tryout.evals.filter((e) => e.playerId !== player.id || chosen.has(e.id)) };
    return buildPlayerFullResults(scoped).find((c) => c.playerId === player.id) ?? null;
  }, [tryout, player, chosen]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryout) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }
  if (!player) return <EmptyState title="Player not found" />;
  if (!canManageTeam || isAssessorOnly) {
    return (
      <Screen>
        <Header title="Report Card" showBack />
        <EmptyState title="Coaches only" message="Report cards are built by the coaching staff." />
      </Screen>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === tryout.teamId);
  const name = playerDisplayName(player);
  const savedCards = cardsQuery.data ?? [];

  const openCard = (c: PlayerReportCard) => {
    setEditingId(c.id);
    setTitle(c.title);
    setSelected(new Set(c.evalIds));
    setCoachComments(c.coachComments);
    setAiComments(c.aiComments);
    setKept(c.attachments);
    setFiles([]);
  };
  const newCard = () => {
    setEditingId(undefined);
    setTitle('Player Report Card');
    setSelected(null);
    setCoachComments('');
    setAiComments('');
    setKept([]);
    setFiles([]);
  };

  const toggleEval = (evalId: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? playerEvals.map((e) => e.id));
      if (next.has(evalId)) next.delete(evalId);
      else next.add(evalId);
      return next;
    });

  const addFile = async () => {
    try {
      const picked = await pickAttachment();
      if (!picked) return;
      // Videos go through account video storage (compressed and counted against the quota).
      if (picked.type.startsWith('video/')) {
        notify('Add videos below', 'Save the report card, then use Add video under Stored videos. Videos are compressed and kept in your video storage.');
        return;
      }
      if (picked.size > MAX_UPLOAD_BYTES) {
        notify('File too large', 'Uploads can be up to 50 MB. For a longer video, add a link instead.');
        return;
      }
      setFiles((prev) => [...prev, picked]);
    } catch (e) {
      if (e instanceof DocumentPickerUnavailable) notify('File Picker Not Available', e.message);
      else notify('Could not pick the file', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const addLink = () => {
    const url = safeExternalUrl(linkUrl.trim());
    if (!url) {
      notify('Check the link', 'Enter a full web address starting with http:// or https://.');
      return;
    }
    setKept((prev) => [...prev, { kind: linkIsVideo ? 'video' : 'link', name: linkName.trim() || url, url }]);
    setLinkName('');
    setLinkUrl('');
  };

  const runAi = async () => {
    if (chosen.size === 0) {
      notify('Select evaluations', 'Choose at least one evaluation for the AI to read.');
      return;
    }
    const go = async () => {
      try {
        const summary = await generate.mutateAsync({ playerId: player.id, evalIds: Array.from(chosen) });
        setAiComments(formatAiComments(summary));
      } catch (e) {
        notify('AI comments unavailable', e instanceof Error ? e.message : 'Could not generate comments.');
      }
    };
    if (aiComments.trim()) {
      typeToConfirm.ask({
        title: 'Replace the AI comments?',
        message: 'This writes new AI comments over the ones above, including any edits you made.',
        confirmLabel: 'Replace',
        onConfirm: go,
      });
    } else {
      await go();
    }
  };

  const saveCard = async () => {
    if (!player.athleteId) {
      notify('Cannot save', 'This player has no athlete record yet.');
      return;
    }
    try {
      const saved = await save.mutateAsync({
        input: {
          id: editingId,
          athleteId: player.athleteId,
          tryoutId: id!,
          title,
          evalIds: Array.from(chosen),
          coachComments,
          aiComments,
          attachments: kept,
        },
        files,
      });
      openCard(saved);
      notify('Saved', 'Report card saved.');
    } catch (e) {
      notify('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const exportPdf = async () => {
    if (!reportCard) return;
    setExporting(true);
    try {
      const { exportPlayerReportCard } = await import('@/lib/exportData');
      await exportPlayerReportCard({
        title,
        subtitle: [team?.name, tryout.name].filter(Boolean).join(' | '),
        card: reportCard,
        coachComments,
        aiComments,
        attachments: [
          ...kept.map((a) => ({ kind: a.kind, name: a.name, url: a.url })),
          ...files.map((f) => ({ kind: (f.type.startsWith('video/') ? 'video' : 'file') as 'video' | 'file', name: f.name })),
        ],
        logoUrls: reportLogoUrls({ club: tier === 'club', organizationLogoUrl: user?.organizationLogoUrl, teamLogoUrl: team?.logoUrl }),
      });
    } catch (e) {
      notify('Export failed', e instanceof Error ? e.message : 'Could not build the PDF.');
    } finally {
      setExporting(false);
    }
  };

  const deleteCard = (c: PlayerReportCard) =>
    typeToConfirm.ask({
      title: 'Delete report card',
      message: `Delete "${c.title}"? Its attached files are deleted too.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await remove.mutateAsync(c);
          if (editingId === c.id) newCard();
        } catch (e) {
          notify('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
        }
      },
    });

  const openUrl = async (url?: string) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      notify('Could not open it', 'No app on this device can open this item.');
    }
  };

  const label = (text: string) => (
    <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
      {text}
    </Text>
  );

  return (
    <Screen padded={false}>
      {typeToConfirm.modal}
      <View className="px-4">
        <Header title="Report Card" subtitle={`${name} | ${tryout.name}`} showBack onBack={() => navigation.goBack()} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {savedCards.length > 0 ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              {label('Saved report cards')}
              <Button label="New" size="sm" variant="ghost" onPress={newCard} />
            </View>
            {savedCards.map((c) => (
              <View key={c.id} className="flex-row items-center gap-2 border-b pb-2" style={{ borderColor: colors.border }}>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-bold flex-shrink" style={{ color: colors.ink }} numberOfLines={1}>
                      {c.title}
                    </Text>
                    {editingId === c.id ? <Badge label="Open" variant="info" /> : null}
                  </View>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    {new Date(c.updatedAt).toLocaleDateString()} · {c.evalIds.length} evaluation{c.evalIds.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Button label="Open" size="sm" variant="secondary" onPress={() => openCard(c)} />
                <Button label="Delete" size="sm" variant="danger" onPress={() => deleteCard(c)} />
              </View>
            ))}
          </Card>
        ) : null}

        <Card className="gap-3">
          <Input label="Title" value={title} onChangeText={setTitle} />
          <View className="gap-2">
            {label('Evaluations to include')}
            {playerEvals.length === 0 ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {name} has no evaluations yet. Score them first to put results on a report card.
              </Text>
            ) : (
              <>
                <View className="flex-row gap-2">
                  <Button label="Select all" size="sm" variant="ghost" onPress={() => setSelected(null)} />
                  <Button label="Clear" size="sm" variant="ghost" onPress={() => setSelected(new Set())} />
                </View>
                {playerEvals.map((e, i) => {
                  const on = chosen.has(e.id);
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => toggleEval(e.id)}
                      className="flex-row items-center gap-2 py-1"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <View
                        className="h-5 w-5 items-center justify-center rounded border"
                        style={{ borderColor: colors.primary, backgroundColor: on ? colors.primary : 'transparent' }}
                      >
                        {on ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                      </View>
                      <Text className="flex-1 text-sm" style={{ color: colors.ink }}>
                        Evaluation {i + 1}: {e.date} · {e.evaluator} · {e.session}
                      </Text>
                    </Pressable>
                  );
                })}
              </>
            )}
          </View>
        </Card>

        {reportCard && reportCard.evalCount > 0 ? (
          <Card className="gap-1">
            {label('Scores from the chosen evaluations')}
            <View className="flex-row justify-between border-b py-1" style={{ borderColor: colors.border }}>
              <Text className="font-bold" style={{ color: colors.primary }}>
                Overall
              </Text>
              <Text className="font-bold" style={{ color: colors.primary }}>
                {reportCard.overallScore} · {reportCard.overallRank}
              </Text>
            </View>
            {reportCard.metrics.map((m) => (
              <View key={m.label} className="flex-row justify-between border-b py-1" style={{ borderColor: colors.border }}>
                <Text style={{ color: colors.ink }}>{m.label}</Text>
                <Text style={{ color: colors.ink }}>
                  {m.score} · {m.rank}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card className="gap-3">
          <Input
            label="Coach comments"
            value={coachComments}
            onChangeText={setCoachComments}
            multiline
            numberOfLines={6}
            placeholder="What to tell the family: strengths, what to work on, next steps."
            style={{ minHeight: 130, textAlignVertical: 'top' }}
          />
          <PlanGate feature="aiReportComments" title="AI comments (Club plan)" tierOverride={tier}>
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                {label('AI comments')}
                <Button
                  label={aiComments.trim() ? 'Regenerate' : 'Generate with AI'}
                  size="sm"
                  variant="secondary"
                  onPress={runAi}
                  loading={generate.isPending}
                />
              </View>
              <Input
                value={aiComments}
                onChangeText={setAiComments}
                multiline
                numberOfLines={8}
                placeholder="Generate comments from the chosen evaluations, then edit them freely."
                style={{ minHeight: 160, textAlignVertical: 'top' }}
              />
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                A draft from the evaluations you chose. Read and edit it before sharing: it is printed as AI-assisted.
              </Text>
            </View>
          </PlanGate>
        </Card>

        <Card className="gap-3">
          {label('Videos, files and links')}
          {kept.length === 0 && files.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Add game video, drill sheets or any link worth showing the family.
            </Text>
          ) : (
            <View className="gap-1.5">
              {kept.map((a, i) => (
                <View key={`k-${i}`} className="flex-row items-center justify-between gap-2">
                  <Pressable className="flex-1" onPress={() => openUrl(a.signedUrl ?? a.url)} disabled={!(a.signedUrl ?? a.url)}>
                    <Text style={{ color: a.signedUrl || a.url ? colors.primary : colors.ink }} numberOfLines={1}>
                      {a.kind === 'video' ? 'Video' : a.kind === 'link' ? 'Link' : 'File'}: {a.name}
                    </Text>
                  </Pressable>
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => setKept((p) => p.filter((_, j) => j !== i))} />
                </View>
              ))}
              {files.map((f, i) => (
                <View key={`f-${i}`} className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-sm" style={{ color: colors.ink }} numberOfLines={2}>
                    {f.type.startsWith('video/') ? 'Video' : 'File'}: {f.name} ({formatSize(f.size)}) (uploads when you save)
                  </Text>
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => setFiles((p) => p.filter((_, j) => j !== i))} />
                </View>
              ))}
            </View>
          )}
          <Button label="Upload a file" variant="secondary" onPress={addFile} />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Files up to 50 MB each. Videos are added under Stored videos once the card is saved, or add a link below.
          </Text>
          <Input label="Link name" value={linkName} onChangeText={setLinkName} placeholder="Game 3 highlights" />
          <Input
            label="Link address"
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setLinkIsVideo((v) => !v)}
            className="flex-row items-center gap-2"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: linkIsVideo }}
          >
            <View
              className="h-5 w-5 items-center justify-center rounded border"
              style={{ borderColor: colors.primary, backgroundColor: linkIsVideo ? colors.primary : 'transparent' }}
            >
              {linkIsVideo ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
            </View>
            <Text style={{ color: colors.ink }}>This link is a video</Text>
          </Pressable>
          <Button label="Add link" variant="secondary" size="sm" onPress={addLink} disabled={!linkUrl.trim()} />
        </Card>

        <Card className="gap-3">
          {editingId ? (
            <ContextVideos
              context="report_card"
              contextId={editingId}
              accountId={savedCards.find((c) => c.id === editingId)?.accountId}
              title="Stored videos"
            />
          ) : (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Save the report card first, then you can add videos from your video storage.
            </Text>
          )}
        </Card>

        <View className="gap-3">
          <Button label={editingId ? 'Save changes' : 'Save report card'} onPress={saveCard} loading={save.isPending} />
          <Button label="Download PDF" variant="secondary" onPress={exportPdf} loading={exporting} disabled={!reportCard} />
        </View>
      </ScrollView>
    </Screen>
  );
}
