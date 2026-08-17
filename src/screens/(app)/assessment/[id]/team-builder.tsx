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
import {
  useTryoutQuery,
  useGenerateTeamBuilderMutation,
  useTeamBuilderResultsQuery,
  useSaveTeamBuilderResultMutation,
  useDeleteTeamBuilderResultMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerNameMap, type TeamBuilderState } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';
import { useUser } from '@/state/authStore';
import { canUseFeature, getPlanDefinition } from '@/data/plans';

export default function TeamBuilderScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
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
  const [lastSavedGeneratedAt, setLastSavedGeneratedAt] = useState<number | null>(null);
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
  const isUnsaved = !viewingResult && !!teamBuilder && teamBuilder.generatedAt !== lastSavedGeneratedAt;
  const nameMap = getPlayerNameMap(tryout);

  const tier = user?.planTier ?? 'free';
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
    if (isUnsaved) {
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
    if (!teamBuilder || !saveLabel.trim()) return;
    await saveMut.mutateAsync({ label: saveLabel.trim(), state: teamBuilder });
    setLastSavedGeneratedAt(teamBuilder.generatedAt);
    setSaveModalVisible(false);
    setSaveLabel('');
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    if (!teamBuilder) return;
    setIsExporting(format);
    try {
      const { exportTeamBuilderData } = await import('@/lib/exportData');
      await exportTeamBuilderData(tryout, teamBuilder, format);
    } catch (e: any) {
      console.error(e);
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

  return (
    <Screen scroll insideTabBar>
      <Header title="Team Builder" subtitle="Sort Out — balanced teams" showBack onBack={() => navigation.navigate('AssessmentResults')} />

      <PlanGate feature="teamBuilder" title="Team Builder">
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

        {teamBuilder?.teams.map((team) => {
          const teamPlayerResults = results.filter((r: any) => team.players.includes(r.player.id) && r.evalCount > 0);
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

        {teamBuilder?.unassigned && teamBuilder.unassigned.length > 0 && (
          <Card className="mb-3 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-lg font-display font-bold" style={{ color: colors.inkMuted }}>
                Unassigned
              </Text>
              <Badge label={`${teamBuilder.unassigned.length} players`} />
            </View>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              These players didn't fit within the requested team count and size, so they were left out instead of being added to a team.
            </Text>
            <Text className="text-sm" style={{ color: colors.ink }}>
              {teamBuilder.unassigned.map((pid) => nameMap[pid] ?? pid).join(', ')}
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
