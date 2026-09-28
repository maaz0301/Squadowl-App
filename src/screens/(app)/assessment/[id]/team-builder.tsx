import { useState, useEffect, useMemo } from 'react';
import { Text, View, ActivityIndicator, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Header,
  LoadingState,
  ErrorState,
  Screen,
  Input,
  Modal,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { FriendPackagesCard } from '@/components/teamBuilder/FriendPackagesCard';
import { TeamAdjuster, UNASSIGNED } from '@/components/teamBuilder/TeamAdjuster';
import {
  useTryoutQuery,
  useGenerateTeamBuilderMutation,
  useTeamBuilderResultsQuery,
  useSaveTeamBuilderResultMutation,
  useDeleteTeamBuilderResultMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import {
  getPlayerNameMap,
  movePlayerToTeam,
  type TeamBuilderState,
  type TeamBuilderTeam,
} from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { nextFrame } from '@/lib/nextFrame';

/** Deepest undo history kept for manual adjustments. */
const MAX_HISTORY = 50;

/** One point in the undo history: the whole assignment, teams and leftovers. */
interface RosterSnapshot {
  teams: TeamBuilderTeam[];
  unassigned: string[];
}

/** Membership-only fingerprint, so manual adjustments count as unsaved changes too. */
function rosterSnapshot(state: TeamBuilderState) {
  return JSON.stringify({
    generatedAt: state.generatedAt,
    teams: state.teams.map((t) => [t.id, [...t.players].sort()]),
    unassigned: [...state.unassigned].sort(),
  });
}

export default function TeamBuilderScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const generate = useGenerateTeamBuilderMutation(id!);
  const resultsQuery = useTeamBuilderResultsQuery(id);
  const saveMut = useSaveTeamBuilderResultMutation(id!);
  const deleteMut = useDeleteTeamBuilderResultMutation(id!);
  const [prompt, setPrompt] = useState('');
  const [tbLoadingText, setTbLoadingText] = useState('Analyzing players...');

  // Which saved snapshot (if any) is currently being viewed instead of the live draft.
  const [viewingResultId, setViewingResultId] = useState<string | null>(null);
  // Set by "New" to hide the current live draft without touching the DB record —
  // the next successful Generate produces a fresh generatedAt that un-hides it.
  const [hiddenGeneratedAt, setHiddenGeneratedAt] = useState<number | null>(null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  // Manual adjustments layered over whichever split is on screen. Null means
  // "untouched", so the generated split shows through unchanged.
  const [editedTeams, setEditedTeams] = useState<TeamBuilderTeam[] | null>(null);
  const [editedUnassigned, setEditedUnassigned] = useState<string[] | null>(null);
  // Undo/redo over manual adjustments only — each entry is the roster as it was
  // *before* one move, so a mis-drop is one tap to take back instead of a hunt
  // for which player came from where.
  const [undoStack, setUndoStack] = useState<RosterSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<RosterSnapshot[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [isExporting, setIsExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const [draftsModalVisible, setDraftsModalVisible] = useState(false);

  const results = useMemo(() => tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : [], [tryoutQuery.data]);

  useEffect(() => {
    if (!generate.isPending) {
      setTbLoadingText('Analyzing players...');
      return;
    }
    const texts = ['Analyzing players...', 'Balancing rosters...', 'Optimizing lines...', 'Finalizing teams...'];
    let idx = 0;
    const int = setInterval(() => {
      idx = (idx + 1) % texts.length;
      setTbLoadingText(texts[idx]);
    }, 2500);
    return () => clearInterval(int);
  }, [generate.isPending]);

  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  // Rebuilding these from a large roster on every keystroke in the prompt box
  // is what made typing there stutter on the web app; memoized for the same
  // reason here, and shared by the adjuster and the team cards.
  const playerById = useMemo(
    () => new Map((tryoutQuery.data?.roster ?? []).map((p) => [p.id, p])),
    [tryoutQuery.data],
  );
  const overallByPlayerId = useMemo(
    () => new Map(results.map((r: any) => [r.player.id, r.overall as number])),
    [results],
  );

  // Identifies *which* split the manual edits belong to. Regenerating, or
  // switching to a saved set, produces a different key — and the edits, which
  // were made against the old split, are dropped rather than reapplied to a
  // roster they no longer describe.
  const liveForKey = tryoutQuery.data?.teamBuilder as TeamBuilderState | undefined;
  const savedForKey = viewingResultId
    ? (resultsQuery.data ?? []).find((r) => r.id === viewingResultId)
    : undefined;
  const splitKey = savedForKey
    ? `saved:${savedForKey.id}`
    : liveForKey && liveForKey.generatedAt !== hiddenGeneratedAt
      ? `live:${liveForKey.generatedAt}`
      : 'none';
  const [lastSplitKey, setLastSplitKey] = useState(splitKey);
  if (splitKey !== lastSplitKey) {
    setLastSplitKey(splitKey);
    setEditedTeams(null);
    setEditedUnassigned(null);
    setUndoStack([]);
    setRedoStack([]);
    setAdjusting(false);
  }

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Team Builder" showBack />
        <ErrorState message="Could not load team builder." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const tryout = tryoutQuery.data;
  const liveTeamBuilder = tryout.teamBuilder as TeamBuilderState | undefined;
  const savedResults = resultsQuery.data ?? [];
  const viewingResult = viewingResultId ? savedResults.find((r) => r.id === viewingResultId) ?? null : null;
  const liveHidden = !!liveTeamBuilder && liveTeamBuilder.generatedAt === hiddenGeneratedAt;
  const teamBuilder: TeamBuilderState | undefined = viewingResult
    ? (viewingResult.state as TeamBuilderState)
    : liveHidden ? undefined : liveTeamBuilder;
  // What the screen actually shows, saves and exports: the generated split with
  // any manual adjustments laid over it.
  const effectiveTeams = editedTeams ?? teamBuilder?.teams ?? [];
  const effectiveUnassigned = editedUnassigned ?? teamBuilder?.unassigned ?? [];
  const editedTeamBuilder: TeamBuilderState | undefined = teamBuilder
    ? { ...teamBuilder, teams: effectiveTeams, unassigned: effectiveUnassigned }
    : undefined;
  // Called on demand rather than derived per render — fingerprinting a large
  // split on every keystroke in the prompt box isn't free.
  const isUnsaved = () =>
    !viewingResult && !!editedTeamBuilder && rosterSnapshot(editedTeamBuilder) !== lastSavedSnapshot;
  const nameMap = getPlayerNameMap(tryout);

  const canReorder = !!editedTeamBuilder;

  const movePlayer = (playerId: string, from: string, to: string) => {
    if (from === to || !editedTeamBuilder) return;
    const isGoalie = playerById.get(playerId)?.pos?.toUpperCase() === 'GTL';
    const next = movePlayerToTeam(editedTeamBuilder, playerId, to === UNASSIGNED ? null : to, isGoalie);
    setUndoStack((stack) =>
      [...stack, { teams: effectiveTeams, unassigned: effectiveUnassigned }].slice(-MAX_HISTORY),
    );
    // A fresh move forks the history, so anything undone past this point is gone.
    setRedoStack([]);
    setEditedTeams(next.teams);
    setEditedUnassigned(next.unassigned);
  };

  const canUndo = canReorder && undoStack.length > 0;
  const canRedo = canReorder && redoStack.length > 0;

  const handleUndo = () => {
    if (!canUndo) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, { teams: effectiveTeams, unassigned: effectiveUnassigned }]);
    setEditedTeams(prev.teams);
    setEditedUnassigned(prev.unassigned);
  };

  const handleRedo = () => {
    if (!canRedo) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, { teams: effectiveTeams, unassigned: effectiveUnassigned }]);
    setEditedTeams(next.teams);
    setEditedUnassigned(next.unassigned);
  };

  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;

  const handleGenerate = () => {
    setViewingResultId(null);
    generate.mutate({
      prompt,
      // Pass defaults, backend might parse prompt for teamCount
      teamCount: 2,
      keepFriendPackages: true,
      splitGoalies: true,
    });
  };

  const handleNew = () => {
    const proceed = () => {
      setPrompt('');
      setViewingResultId(null);
      if (liveTeamBuilder) setHiddenGeneratedAt(liveTeamBuilder.generatedAt);
    };
    if (isUnsaved()) {
      Alert.alert(
        'Discard this team split?',
        "This team split hasn't been saved. Starting a new one will discard it unless you save it first.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: proceed },
        ],
      );
    } else {
      proceed();
    }
  };

  const handleSaveConfirm = async () => {
    if (!editedTeamBuilder || !saveLabel.trim()) return;
    const snapshot = rosterSnapshot(editedTeamBuilder);
    await saveMut.mutateAsync({ label: saveLabel.trim(), state: editedTeamBuilder });
    setLastSavedSnapshot(snapshot);
    setSaveModalVisible(false);
    setSaveLabel('');
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (!editedTeamBuilder) return;
    setIsExporting(format);
    try {
      await nextFrame();
      const { exportTeamBuilderData } = await import('@/lib/exportData');
      await exportTeamBuilderData(tryout, editedTeamBuilder, format);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Export Failed', e?.message || `Could not export the ${format.toUpperCase()}.`);
    } finally {
      setIsExporting(null);
    }
  };

  const handleDeleteResult = (resultId: string, label: string) => {
    Alert.alert('Delete saved teams?', `"${label}" will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (viewingResultId === resultId) setViewingResultId(null);
          deleteMut.mutate(resultId);
        },
      },
    ]);
  };

  // Not scrolling, and not a Modal: the adjuster owns its own layout, and its
  // drag has to claim the touch without an outer scroll view fighting it for
  // the gesture.
  if (adjusting && editedTeamBuilder) {
    return (
      <Screen insideTabBar>
        <TeamAdjuster
          teams={effectiveTeams}
          unassigned={effectiveUnassigned}
          playerById={playerById}
          overallByPlayerId={overallByPlayerId}
          onMove={movePlayer}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onDone={() => setAdjusting(false)}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll insideTabBar>
      <Header title="Team Builder" subtitle="Sort Out: balanced teams" showBack onBack={() => navigation.navigate('AssessmentResults')} />

      <PlanGate feature="teamBuilder" title="Team Builder" tierOverride={tier}>
        <Card accent className="gap-3 mb-4">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Configuration
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {tryout.roster.length} players
          </Text>

          <Input
            multiline
            numberOfLines={4}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="e.g. Build 4 teams, keep friend packages together, balance birth years..."
            style={{ minHeight: 100, textAlignVertical: 'top' }}
            editable={!generate.isPending}
          />

          {generate.isPending ? (
            <View className="items-center p-4">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text className="mt-2 text-center" style={{ color: colors.ink }}>
                {tbLoadingText}
              </Text>
            </View>
          ) : (
            <Button label="✨ Generate Teams with AI" onPress={handleGenerate} loading={generate.isPending} />
          )}

          {generate.isError && (
            <View className="mt-3 p-3 rounded-md" style={{ backgroundColor: colors.tile }}>
              <Text style={{ color: colors.ink, fontWeight: 'bold' }}>Notice</Text>
              <Text style={{ color: colors.inkMuted, marginTop: 4 }}>
                {generate.error?.message || "Team builder generation timed out. The server might be busy, please try again."}
              </Text>
              <Button
                label="Retry"
                size="sm"
                variant="secondary"
                className="mt-2"
                onPress={handleGenerate}
              />
            </View>
          )}
        </Card>

        <FriendPackagesCard tryout={tryout} disabled={generate.isPending} />

        {savedResults.length > 0 && (
          <Pressable onPress={() => setDraftsModalVisible(true)}>
            <Card className="mb-4 flex-row items-center justify-between">
              <View>
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  📁 Saved Team Sets
                </Text>
                <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                  {viewingResult ? `Viewing "${viewingResult.label}"` : 'Tap to browse & load a draft'}
                </Text>
              </View>
              <Badge label={String(savedResults.length)} />
            </Card>
          </Pressable>
        )}

        {teamBuilder && (
          <View className="flex-row flex-wrap gap-2 mb-2">
            <Button
              label="Adjust"
              size="sm"
              className="flex-1"
              disabled={!canReorder}
              onPress={() => setAdjusting(true)}
            />
            <Button label="↶ Undo" variant="secondary" size="sm" disabled={!canUndo} onPress={handleUndo} />
            <Button label="↷ Redo" variant="secondary" size="sm" disabled={!canRedo} onPress={handleRedo} />
          </View>
        )}

        {teamBuilder && (
          <Text className="text-xs mb-3" style={{ color: colors.inkMuted }}>
            Adjust moves players between teams: hold a player to drag them onto a team, or tap one and pick a
            team. Team averages update as you go.
          </Text>
        )}

        {teamBuilder && (
          <View className="flex-row gap-2 mb-4">
            <Button
              label="Save"
              variant="secondary"
              size="sm"
              className="flex-1"
              onPress={() => setSaveModalVisible(true)}
              loading={saveMut.isPending}
            />
            <Button label="New" variant="secondary" size="sm" className="flex-1" onPress={handleNew} />
            {exportsAllowed && allowedFormats.includes('xlsx') && (
              <Button
                label="XLSX"
                variant="secondary"
                size="sm"
                className="flex-1"
                onPress={() => handleExport('xlsx')}
                loading={isExporting === 'xlsx'}
              />
            )}
            {exportsAllowed && allowedFormats.includes('pdf') && (
              <Button
                label="PDF"
                variant="secondary"
                size="sm"
                className="flex-1"
                onPress={() => handleExport('pdf')}
                loading={isExporting === 'pdf'}
              />
            )}
          </View>
        )}

        {teamBuilder?.explanation && (
          <Card className="mb-4 bg-primary/10 border border-primary/20">
            <Text className="font-display font-bold mb-1" style={{ color: colors.primary }}>
              ✨ AI Co-Coach Insight
            </Text>
            <Text style={{ color: colors.ink }}>
              {teamBuilder.explanation}
            </Text>
          </Card>
        )}

        {teamBuilder?.warnings && teamBuilder.warnings.length > 0 && (
          <View className="mb-4 gap-2">
            {teamBuilder.warnings.map((w, i) => {
              // Strip UUIDs so we don't accidentally leak player IDs into the UI
              const cleanText = w.replace(/\(?(ID: )?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)?/gi, '').trim();
              return (
              <View
                key={i}
                className="flex-row items-center p-3 rounded-md border"
                style={{ backgroundColor: colors.warning + '15', borderColor: colors.warning + '30' }}
              >
                <Text className="flex-1 text-sm font-medium" style={{ color: colors.warning }}>
                  {cleanText}
                </Text>
              </View>
            )})}
          </View>
        )}

        {effectiveTeams.map((team) => {
          // `overall > 0` as well as having evaluations: a player scored only
          // against rubrics that no longer exist comes back with evaluations and
          // an overall of 0, and 0 is the absence of a rating rather than a very
          // low one. Counting those zeros pulled a team's average toward nothing
          // and made this number disagree with the split buildTeams() produced.
          // Matches the web app's Team Builder page.
          const teamPlayerResults = results.filter(
            (r: any) => team.players.includes(r.player.id) && r.evalCount > 0 && r.overall > 0,
          );
          const avgScore = teamPlayerResults.length > 0
            ? (teamPlayerResults.reduce((sum: number, r: any) => sum + r.overall, 0) / teamPlayerResults.length).toFixed(1)
            : null;

          return (
          <Pressable
            key={team.id}
            onPress={() =>
              navigation.navigate('AssessmentTeamBuilderTeam', {
                id,
                teamId: team.id,
                resultId: viewingResult?.id,
                // Manual adjustments live only in this screen's state, so the
                // detail screen would otherwise re-read the pre-edit split out
                // of the query and show the wrong roster.
                editedState: editedTeams || editedUnassigned ? editedTeamBuilder : undefined,
              })
            }
          >
            <Card className="mb-3 gap-2">
              <View className="flex-row justify-between">
                <Text className="text-lg font-display font-bold" style={{ color: colors.primary }}>
                  {team.name}
                </Text>
                <View className="flex-row gap-2">
                  {avgScore && <Badge label={`Avg: ${avgScore}`} variant="success" />}
                  <Badge label={`${team.players.length} players`} />
                </View>
              </View>
              {team.skaters.length > 0 ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  Skaters: {team.skaters.map((pid) => nameMap[pid] ?? pid).join(', ')}
                </Text>
              ) : null}
              {team.goalies.length > 0 ? (
                <Text className="text-sm" style={{ color: colors.inkFaint }}>
                  Goalies: {team.goalies.map((pid) => nameMap[pid] ?? pid).join(', ')}
                </Text>
              ) : null}
            </Card>
          </Pressable>
        )})}

        {effectiveUnassigned.length > 0 && (
          <Card className="mb-3 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-lg font-display font-bold" style={{ color: colors.inkMuted }}>
                Unassigned
              </Text>
              <Badge label={`${effectiveUnassigned.length} players`} />
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              These players didn't fit within the requested team count and size, so they were left out instead of being added to a team.
            </Text>
            <Text className="text-sm" style={{ color: colors.ink }}>
              {effectiveUnassigned.map((pid) => nameMap[pid] ?? pid).join(', ')}
            </Text>
          </Card>
        )}
      </PlanGate>

      <Modal
        visible={saveModalVisible}
        title="Save Team Set"
        onClose={() => setSaveModalVisible(false)}
        footer={
          <View className="mt-4 gap-2">
            <Button label="Save" onPress={handleSaveConfirm} loading={saveMut.isPending} disabled={!saveLabel.trim()} />
            <Button label="Cancel" variant="secondary" onPress={() => setSaveModalVisible(false)} />
          </View>
        }
      >
        <Input
          value={saveLabel}
          onChangeText={setSaveLabel}
          placeholder="e.g. Aug 14 Draft"
          autoFocus
        />
      </Modal>

      <Modal
        visible={draftsModalVisible}
        title="Saved Team Sets"
        onClose={() => setDraftsModalVisible(false)}
      >
        <View className="gap-2">
          {savedResults.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                setViewingResultId(r.id);
                setDraftsModalVisible(false);
              }}
              className="flex-row items-center justify-between p-3 rounded-md border"
              style={{
                backgroundColor: viewingResultId === r.id ? colors.primary + '15' : colors.tile,
                borderColor: viewingResultId === r.id ? colors.primary : colors.border,
              }}
            >
              <View className="flex-1">
                <Text className="font-bold" style={{ color: colors.ink }}>{r.label}</Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {new Date(r.createdAt).toLocaleString()}
                </Text>
              </View>
              <Pressable onPress={() => handleDeleteResult(r.id, r.label)} hitSlop={10}>
                <Text style={{ color: colors.danger }}>Delete</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      </Modal>
    </Screen>
  );
}
