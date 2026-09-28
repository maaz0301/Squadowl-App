import { useState, useMemo } from 'react';
import { Alert, Text, View, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
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
import {
  useTryoutQuery,
  useTeamBuilderResultsQuery,
  useSaveTeamBuilderResultMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName } from '@/data/rubrics';
import { type TeamBuilderState } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';
import { useUser } from '@/state/authStore';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { nextFrame } from '@/lib/nextFrame';

export default function TeamBuilderTeamScreen() {
  const id = useAssessmentId();
  const route = useRoute<any>();
  const { teamId, resultId, editedState } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const resultsQuery = useTeamBuilderResultsQuery(id);
  const saveMut = useSaveTeamBuilderResultMutation(id!);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [isExporting, setIsExporting] = useState<'xlsx' | 'pdf' | null>(null);

  const results = useMemo(() => tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : [], [tryoutQuery.data]);

  if (tryoutQuery.isLoading || (resultId && resultsQuery.isLoading)) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Team" showBack />
        <ErrorState message="Could not load this team." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const tryout = tryoutQuery.data;
  const savedResult = resultId ? (resultsQuery.data ?? []).find((r) => r.id === resultId) : undefined;
  // The adjusted split wins when one was handed over: it is the same split the
  // coach was just looking at, with moves the query doesn't know about yet.
  const state: TeamBuilderState | undefined = (editedState as TeamBuilderState | undefined)
    ?? (savedResult
      ? (savedResult.state as TeamBuilderState)
      : (tryout.teamBuilder as TeamBuilderState | undefined));
  const team = state?.teams.find((t) => t.id === teamId);

  if (!state || !team) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Team" showBack />
        <ErrorState message="This team is no longer available." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const playerById = new Map(tryout.roster.map((p) => [p.id, p]));
  const overallByPlayerId = new Map(results.map((r: any) => [r.player.id, r.overall]));
  const teamPlayerResults = results.filter((r: any) => team.players.includes(r.player.id) && r.evalCount > 0);
  const avgScore = teamPlayerResults.length > 0
    ? (teamPlayerResults.reduce((sum: number, r: any) => sum + r.overall, 0) / teamPlayerResults.length).toFixed(1)
    : null;

  const tier = effectiveTier;
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;

  const handleSaveConfirm = async () => {
    if (!saveLabel.trim()) return;
    await saveMut.mutateAsync({ label: saveLabel.trim(), state });
    setSaveModalVisible(false);
    setSaveLabel('');
  };

  const handleExport = async (format: 'xlsx' | 'pdf') => {
    setIsExporting(format);
    try {
      await nextFrame();
      const { exportTeamBuilderData } = await import('@/lib/exportData');
      await exportTeamBuilderData(tryout, state, format, { teamId: team.id });
    } catch (e: any) {
      console.error(e);
      Alert.alert('Export Failed', e?.message || `Could not export the ${format.toUpperCase()}.`);
    } finally {
      setIsExporting(null);
    }
  };

  const openPlayer = (playerId: string) => {
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentPlayer', params: { id, playerId } });
  };

  const renderPlayerCard = (playerId: string) => {
    const p = playerById.get(playerId);
    if (!p) return null;
    const overall = overallByPlayerId.get(playerId);
    return (
      <Pressable key={playerId} onPress={() => openPlayer(playerId)}>
        <View
          className="flex-row items-center gap-3 p-3 mb-2 rounded-lg border"
          style={{ backgroundColor: colors.card, borderColor: colors.border }}
        >
          <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} />
          <View className="flex-1">
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {playerDisplayName(p)}
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              #{p.jersey ?? '-'} · {p.pos ?? '-'}
            </Text>
          </View>
          {overall != null && <Badge label={overall.toFixed(1)} variant="success" />}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen scroll insideTabBar>
      <Header title={team.name} subtitle={savedResult ? `Saved: ${savedResult.label}` : 'Team Builder'} showBack />

      <Card accent className="mb-4 gap-2">
        <View className="flex-row justify-between items-center">
          <Text className="text-lg font-display font-bold" style={{ color: colors.primary }}>
            {team.name}
          </Text>
          <View className="flex-row gap-2">
            {avgScore && <Badge label={`Avg: ${avgScore}`} variant="success" />}
            <Badge label={`${team.players.length} players`} />
          </View>
        </View>
      </Card>

      <View className="flex-row gap-2 mb-4">
        <Button
          label="Save"
          variant="secondary"
          size="sm"
          className="flex-1"
          onPress={() => setSaveModalVisible(true)}
          loading={saveMut.isPending}
        />
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

      {team.skaters.length > 0 && (
        <View className="mb-4">
          <Text className="text-sm font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>
            Skaters
          </Text>
          {team.skaters.map(renderPlayerCard)}
        </View>
      )}

      {team.goalies.length > 0 && (
        <View className="mb-4">
          <Text className="text-sm font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>
            Goalies
          </Text>
          {team.goalies.map(renderPlayerCard)}
        </View>
      )}

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
    </Screen>
  );
}
