import { useEffect, useMemo, useRef, useState } from 'react';
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
  useCombinedTryoutsQueries,
  useDeletePlayerReportCardMutation,
  useEvaluationCandidatesQuery,
  useGenerateReportCardCommentsMutation,
  useLibraryQuery,
  usePlayerReportCardsQuery,
  useSavePlayerReportCardMutation,
  useTeamsQuery,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { getDataSource } from '@/data';
import { buildPlayerFullResults, type PlayerFullResults } from '@/data/resultsExport';
import { benchmarkLines, type BenchmarkLine } from '@/data/benchmarks';
import { playerDisplayName } from '@/data/rubrics';
import { extraMarker, matchPlayerAcrossEvaluations, splitSavedEvalIds } from '@/data/otherEvaluations';
import type { PlayerReportCard, ReportCardAttachment } from '@/data/types';
import { DocumentPickerUnavailable, pickAttachment, type PickedAttachment } from '@/lib/documentPicker';
import { ContextVideos } from '@/components/video/ContextVideos';
import { TaggedVideos } from '@/components/video/TaggedVideos';
import { formatAiComments } from '@/lib/reportCardText';
import { addLibraryVideos } from '@/lib/reportCardLibrary';
import { VideoPlayerModal } from '@/components/video/VideoPlayerModal';
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

/** A yes/no question, answered by tapping a button; resolves false if dismissed. */
function askYesNo(title: string, message: string, yes: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(!!(globalThis as any).confirm?.(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: 'Not the same', style: 'cancel', onPress: () => resolve(false) },
        { text: yes, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

/** One evaluation's scores for the player: rubric results, benchmarks and the rank within that evaluation alone. */
function ScoreTable({ card: reportCard, benchmarks }: { card: PlayerFullResults; benchmarks: BenchmarkLine[] }) {
  const colors = useThemeColors();
  return (
    <>
      <View className="flex-row items-center gap-2 border-b py-1" style={{ borderColor: colors.border }}>
        <Text className="flex-1 text-xs font-bold" style={{ color: colors.inkMuted }}>
          MEASURE
        </Text>
        <Text className="w-20 text-right text-xs font-bold" style={{ color: colors.inkMuted }}>
          RESULT
        </Text>
        <Text className="w-20 text-right text-xs font-bold" style={{ color: colors.inkMuted }}>
          BENCHMARK
        </Text>
        <Text className="w-12 text-right text-xs font-bold" style={{ color: colors.inkMuted }}>
          RANK
        </Text>
      </View>
      <View className="flex-row items-center gap-2 border-b py-1" style={{ borderColor: colors.border }}>
        <Text className="flex-1 font-bold" style={{ color: colors.primary }}>
          Overall
        </Text>
        <Text className="w-20 text-right font-bold" style={{ color: colors.primary }}>
          {reportCard.overallScore || '-'}
        </Text>
        <Text className="w-20 text-right" style={{ color: colors.inkMuted }}>
          -
        </Text>
        <Text className="w-12 text-right font-bold" style={{ color: colors.primary }}>
          {reportCard.overallRank || '-'}
        </Text>
      </View>
      {reportCard.metrics.flatMap((m) => [{ ...m, indent: false }, ...(m.children ?? []).map((c) => ({ ...c, indent: true }))]).map((m) => {
        const note = benchmarks.find((b) => b.label === m.label)?.note;
        return (
          <View key={`${m.indent ? 'drill' : 'cat'}:${m.label}`} className="border-b py-1" style={{ borderColor: colors.border }}>
            <View className="flex-row items-center gap-2">
              <Text className="flex-1" style={{ color: m.indent ? colors.inkMuted : colors.ink, paddingLeft: m.indent ? 14 : 0, fontSize: m.indent ? 13 : undefined }}>
                {m.label}
              </Text>
              <Text className="w-20 text-right font-bold" style={{ color: m.met ? colors.success : colors.ink }}>
                {m.actual || m.score}
              </Text>
              <Text className="w-20 text-right" style={{ color: colors.inkMuted }}>
                {m.benchmark || '-'}
              </Text>
              <Text className="w-12 text-right" style={{ color: colors.ink }}>
                {m.rank || '-'}
              </Text>
            </View>
            {note ? (
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {note}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text className="pt-1 text-xs" style={{ color: colors.inkMuted }}>
        Result is the player's average in the measure's own units. Rank is against the roster. Overall is the weighted score out of 5.
      </Text>
    </>
  );
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
  const [pickingLibrary, setPickingLibrary] = useState(false);
  const [libraryPick, setLibraryPick] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  const library = useLibraryQuery({ enabled: pickingLibrary || kept.some((a) => a.libraryItemId) });
  const [files, setFiles] = useState<PickedAttachment[]>([]);
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkIsVideo, setLinkIsVideo] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Other evaluations combined onto this card. `picked` null means every evaluation of the player in it.
  const [extras, setExtras] = useState<{ tryoutId: string; playerId: string; picked: Set<string> | null }[]>([]);
  const [addingEval, setAddingEval] = useState(false);
  const [evalSearch, setEvalSearch] = useState('');
  const [evalPick, setEvalPick] = useState<Set<string>>(new Set());
  const [printAppLogo, setPrintAppLogo] = useState(true);

  // Coming back to the builder reopens the card saved last, so it does not look
  // as though the card vanished. "New" still starts a blank one.
  const reopened = useRef(false);
  const applySavedEvalIds = (saved: string[]) => {
    const { evalIds, extras: marked } = splitSavedEvalIds(saved);
    setSelected(new Set(evalIds));
    setExtras(marked.map((m) => ({ ...m, picked: new Set(evalIds) })));
  };
  useEffect(() => {
    if (reopened.current || !cardsQuery.data) return;
    reopened.current = true;
    const latest = cardsQuery.data.filter((c) => !c.tryoutId || c.tryoutId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!latest) return;
    setEditingId(latest.id);
    setTitle(latest.title);
    applySavedEvalIds(latest.evalIds);
    setCoachComments(latest.coachComments);
    setAiComments(latest.aiComments);
    setKept(latest.attachments);
  }, [cardsQuery.data, id]);

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

  // The rubrics' benchmarks beside this player's average over the chosen evaluations.
  const benchmarks = useMemo(() => {
    if (!tryout || !player) return [];
    const scoped = { ...tryout, evals: tryout.evals.filter((e) => e.playerId !== player.id || chosen.has(e.id)) };
    return benchmarkLines(scoped, player);
  }, [tryout, player, chosen]);

  // Each combined evaluation is worked out on its own, with its own ranks, never blended with the others.
  const extraQueries = useCombinedTryoutsQueries(extras.map((x) => x.tryoutId));
  const extraStamp = extraQueries.map((q) => q.dataUpdatedAt).join(',');
  const extraSections = useMemo(
    () =>
      extras.map((x, i) => {
        const q = extraQueries[i];
        const t = q?.data;
        const row = t?.roster.find((r) => r.id === x.playerId);
        const evals = t && row ? t.evals.filter((e) => e.playerId === row.id).sort((a, b) => a.createdAt - b.createdAt) : [];
        const chosenIds = new Set(x.picked ?? evals.map((e) => e.id));
        const scoped = t && row ? { ...t, evals: t.evals.filter((e) => e.playerId !== row.id || chosenIds.has(e.id)) } : null;
        return {
          tryoutId: x.tryoutId,
          playerId: x.playerId,
          name: t?.name ?? 'Evaluation',
          loading: !!q?.isLoading,
          error: !!q?.isError || (!!t && !row),
          evals,
          chosen: new Set(evals.filter((e) => chosenIds.has(e.id)).map((e) => e.id)),
          card: scoped && row ? (buildPlayerFullResults(scoped).find((c) => c.playerId === row.id) ?? null) : null,
          benchmarks: scoped && row ? benchmarkLines(scoped, row) : [],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extras, extraStamp],
  );

  const who = useMemo(
    () =>
      player
        ? { athleteIds: [player.athleteId].filter((x): x is string => !!x), first: player.first, last: player.last }
        : undefined,
    [player],
  );
  const candidatesQuery = useEvaluationCandidatesQuery(id, who, addingEval);
  const evalMatches = useMemo(() => {
    if (!player || !candidatesQuery.data) return [];
    const taken = new Set(extras.map((x) => x.tryoutId));
    return matchPlayerAcrossEvaluations(
      { athleteIds: who?.athleteIds ?? [], first: player.first, last: player.last, yearOfBirth: player.yearOfBirth, playerEmail: player.playerEmail },
      candidatesQuery.data,
    ).filter((m) => !taken.has(m.tryoutId));
  }, [player, who, candidatesQuery.data, extras]);
  const shownMatches = evalMatches.filter((m) => m.tryoutName.toLowerCase().includes(evalSearch.trim().toLowerCase()));

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
    applySavedEvalIds(c.evalIds);
    setCoachComments(c.coachComments);
    setAiComments(c.aiComments);
    setKept(c.attachments);
    setFiles([]);
  };
  const newCard = () => {
    setEditingId(undefined);
    setTitle('Player Report Card');
    setSelected(null);
    setExtras([]);
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

  const removeExtra = (tryoutId: string) => setExtras((prev) => prev.filter((x) => x.tryoutId !== tryoutId));
  const toggleExtraEval = (tryoutId: string, evalId: string) =>
    setExtras((prev) =>
      prev.map((x) => {
        if (x.tryoutId !== tryoutId) return x;
        const sec = extraSections.find((e) => e.tryoutId === tryoutId);
        const next = new Set(x.picked ?? sec?.evals.map((e) => e.id) ?? []);
        if (next.has(evalId)) next.delete(evalId);
        else next.add(evalId);
        return { ...x, picked: next };
      }),
    );

  const addPickedEvaluations = async () => {
    const chosenMatches = evalMatches.filter((m) => evalPick.has(m.tryoutId));
    const added: typeof extras = [];
    for (const m of chosenMatches) {
      if (m.uncertain) {
        const ok = await askYesNo(
          'Is this the same athlete?',
          `${m.tryoutName} has "${m.playerName}", who ${m.why}. Is that ${name}? Only combine them if it is the same person.`,
          'Same athlete',
        );
        if (!ok) continue;
      }
      added.push({ tryoutId: m.tryoutId, playerId: m.playerId, picked: null });
    }
    if (added.length) setExtras((prev) => [...prev, ...added]);
    setEvalPick(new Set());
    setAddingEval(false);
    setEvalSearch('');
  };

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

  const libraryVideos = (library.data ?? []).filter((i) => i.kind === 'video');

  const addFromLibrary = () => {
    const r = addLibraryVideos(kept, libraryVideos.filter((i) => libraryPick.has(i.id)));
    setKept(r.next);
    setLibraryPick(new Set());
    setPickingLibrary(false);
    if (r.unplayable) notify('Some videos were skipped', `${r.unplayable} chosen video${r.unplayable === 1 ? ' has' : 's have'} nothing to play yet.`);
  };

  /** A video from the Library plays in the app when it is stored; anything else opens its address. */
  const openAttachment = (a: ReportCardAttachment) => {
    const stored = a.libraryItemId && !a.url ? library.data?.find((i) => i.id === a.libraryItemId)?.video?.url : undefined;
    if (stored) setPlaying({ url: stored, title: a.name });
    else void openUrl(a.signedUrl ?? a.url);
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

  // The player's own evaluations here, then each combined evaluation as a marker plus the ones ticked in it.
  const savedEvalIds = [
    ...Array.from(chosen),
    ...extraSections.flatMap((x) => [extraMarker(x.tryoutId, x.playerId), ...Array.from(x.chosen)]),
  ];
  const stillLoadingExtras = extraSections.some((x) => x.loading);

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
          evalIds: savedEvalIds,
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
      // Saved uploads get a long-lived address so the exported PDF can open them.
      const fileLinks = await getDataSource().getReportCardFileLinks(kept.map((a) => a.path).filter((x): x is string => !!x));
      await exportPlayerReportCard({
        title,
        subtitle: [team?.name, tryout.name].filter(Boolean).join(' | '),
        card: reportCard,
        benchmarks,
        evaluationName: tryout.name,
        extras: extraSections
          .filter((x) => x.card && x.card.evalCount > 0)
          .map((x) => ({ name: x.name, card: x.card!, benchmarks: x.benchmarks })),
        coachComments,
        aiComments,
        attachments: [
          ...kept.map((a) => ({ kind: a.kind, name: a.name, url: a.url ?? (a.path ? fileLinks[a.path] : undefined) })),
          ...files.map((f) => ({ kind: (f.type.startsWith('video/') ? 'video' : 'file') as 'video' | 'file', name: f.name })),
        ],
        logoUrls: reportLogoUrls({ club: tier === 'club', organizationLogoUrl: user?.organizationLogoUrl, teamLogoUrl: team?.logoUrl, appLogo: printAppLogo }),
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
      <VideoPlayerModal url={playing?.url ?? null} title={playing?.title ?? ''} onClose={() => setPlaying(null)} />
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
                    {new Date(c.updatedAt).toLocaleDateString()} · {splitSavedEvalIds(c.evalIds).evalIds.length} evaluation{splitSavedEvalIds(c.evalIds).evalIds.length === 1 ? '' : 's'}
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

        <Card className="gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <View className="flex-1">
              {label('Other evaluations')}
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Combine {name}'s scores from other evaluations. Each stays in its own section with its own ranking.
              </Text>
            </View>
            <Button label="+ Add Evaluation" size="sm" variant="secondary" onPress={() => setAddingEval((v) => !v)} />
          </View>
          {addingEval ? (
            <View className="gap-2 rounded-xl border p-3" style={{ borderColor: colors.border }}>
              <Input placeholder="Search evaluations" value={evalSearch} onChangeText={setEvalSearch} autoCapitalize="none" />
              {candidatesQuery.isLoading ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  Looking for {name} in your other evaluations...
                </Text>
              ) : candidatesQuery.isError ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  Could not search your evaluations. Try again in a moment.
                </Text>
              ) : shownMatches.length === 0 ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  {evalMatches.length === 0 ? (extras.length ? `Every other evaluation with ${name} is already added.` : `${name} is not in any other evaluation.`) : 'No evaluation matches that search.'}
                </Text>
              ) : (
                shownMatches.map((m) => {
                  const on = evalPick.has(m.tryoutId);
                  return (
                    <Pressable
                      key={m.tryoutId}
                      onPress={() =>
                        setEvalPick((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(m.tryoutId);
                          else next.add(m.tryoutId);
                          return next;
                        })
                      }
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
                      <Text className="flex-1 text-sm" style={{ color: colors.ink }} numberOfLines={2}>
                        {m.tryoutName}
                        {m.playerName && m.playerName !== name ? <Text style={{ color: colors.inkMuted }}> as {m.playerName}</Text> : null}
                      </Text>
                      {m.uncertain ? <Badge label="Confirm name" variant="warning" /> : null}
                    </Pressable>
                  );
                })
              )}
              <View className="flex-row gap-2">
                <Button
                  label={evalPick.size ? `Add ${evalPick.size} evaluation${evalPick.size === 1 ? '' : 's'}` : 'Add evaluations'}
                  size="sm"
                  onPress={addPickedEvaluations}
                  disabled={evalPick.size === 0}
                />
                <Button label="Cancel" size="sm" variant="ghost" onPress={() => { setAddingEval(false); setEvalPick(new Set()); setEvalSearch(''); }} />
              </View>
            </View>
          ) : null}
        </Card>

        {reportCard && (reportCard.evalCount > 0 || reportCard.metrics.length > 0) ? (
          <Card className="gap-1">
            {label(extraSections.length ? `Report card: ${tryout.name}` : 'Report card')}
            <ScoreTable card={reportCard} benchmarks={benchmarks} />
          </Card>
        ) : null}

        {extraSections.map((x) => (
          <Card key={x.tryoutId} className="gap-2">
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-1">{label(`Report card: ${x.name}`)}</View>
              <Button label="Remove" size="sm" variant="ghost" onPress={() => removeExtra(x.tryoutId)} />
            </View>
            {x.loading ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Loading...
              </Text>
            ) : x.error || !x.card ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Could not load this evaluation.
              </Text>
            ) : (
              <>
                {x.evals.map((e, i) => {
                  const on = x.chosen.has(e.id);
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => toggleExtraEval(x.tryoutId, e.id)}
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
                {x.card.evalCount > 0 ? (
                  <ScoreTable card={x.card} benchmarks={x.benchmarks} />
                ) : (
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {x.evals.length === 0 ? 'No scores for this player in this evaluation yet.' : 'No evaluations ticked for this one.'}
                  </Text>
                )}
              </>
            )}
          </Card>
        ))}

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
          <PlanGate feature="aiReportComments" title="AI comments (Coach+ plan)" tierOverride={tier}>
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
                  <Pressable className="flex-1" onPress={() => openAttachment(a)} disabled={!(a.signedUrl ?? a.url ?? a.libraryItemId)}>
                    <Text style={{ color: a.signedUrl || a.url || a.libraryItemId ? colors.primary : colors.ink }} numberOfLines={2}>
                      {a.kind === 'video' ? 'Video' : a.kind === 'link' ? 'Link' : 'File'}: {a.name}
                      {a.libraryItemId && !a.url ? ' (from your Library, plays in the app, not linked in the PDF)' : ''}
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
          <Button label="Add from your Library" variant="secondary" onPress={() => setPickingLibrary((v) => !v)} />
          {pickingLibrary ? (
            <View className="gap-2 rounded-xl border p-3" style={{ borderColor: colors.border }}>
              {label('Library videos')}
              {library.isLoading ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  Loading your Library...
                </Text>
              ) : libraryVideos.length === 0 ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  No videos in your Library yet.
                </Text>
              ) : (
                libraryVideos.map((v) => {
                  const already = kept.some((a) => a.libraryItemId === v.id);
                  const on = already || libraryPick.has(v.id);
                  return (
                    <Pressable
                      key={v.id}
                      disabled={already}
                      onPress={() =>
                        setLibraryPick((prev) => {
                          const next = new Set(prev);
                          if (next.has(v.id)) next.delete(v.id);
                          else next.add(v.id);
                          return next;
                        })
                      }
                      className="flex-row items-center gap-2 py-1"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: already }}
                    >
                      <View
                        className="h-5 w-5 items-center justify-center rounded border"
                        style={{ borderColor: colors.primary, backgroundColor: on ? colors.primary : 'transparent', opacity: already ? 0.5 : 1 }}
                      >
                        {on ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                      </View>
                      <Text className="flex-1 text-sm" style={{ color: already ? colors.inkMuted : colors.ink }} numberOfLines={1}>
                        {v.title}
                        {already ? ' (added)' : ''}
                      </Text>
                    </Pressable>
                  );
                })
              )}
              <View className="flex-row gap-2">
                <Button
                  label={libraryPick.size ? `Add ${libraryPick.size} video${libraryPick.size === 1 ? '' : 's'}` : 'Add videos'}
                  size="sm"
                  onPress={addFromLibrary}
                  disabled={libraryPick.size === 0}
                />
                <Button
                  label="Cancel"
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    setPickingLibrary(false);
                    setLibraryPick(new Set());
                  }}
                />
              </View>
            </View>
          ) : null}
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
          <TaggedVideos athleteId={player.athleteId} person={{ first: player.first, last: player.last }} />
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
          <Button label={editingId ? 'Save changes' : 'Save report card'} onPress={saveCard} loading={save.isPending} disabled={stillLoadingExtras} />
          {(tier === 'club' && user?.organizationLogoUrl) || team?.logoUrl ? (
            <Pressable
              onPress={() => setPrintAppLogo((v) => !v)}
              className="flex-row items-center gap-2"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: printAppLogo }}
            >
              <View
                className="h-5 w-5 items-center justify-center rounded border"
                style={{ borderColor: colors.primary, backgroundColor: printAppLogo ? colors.primary : 'transparent' }}
              >
                {printAppLogo ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
              </View>
              <Text className="flex-1" style={{ color: colors.ink }}>
                Also print the SquadOwl logo beside your team logo
              </Text>
            </Pressable>
          ) : null}
          <Button label="Download PDF" variant="secondary" onPress={exportPdf} loading={exporting} disabled={!reportCard} />
        </View>
      </ScrollView>
    </Screen>
  );
}
