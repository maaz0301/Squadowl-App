import { useState, useEffect, useMemo } from 'react';
import { Text, View, ActivityIndicator } from 'react-native';
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
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useGenerateTeamBuilderMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerNameMap, type TeamBuilderState } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';

export default function TeamBuilderScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const generate = useGenerateTeamBuilderMutation(id!);
  const [prompt, setPrompt] = useState('');
  const [tbLoadingText, setTbLoadingText] = useState('Analyzing players...');

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
  const teamBuilder = tryout.teamBuilder as TeamBuilderState | undefined;
  const nameMap = getPlayerNameMap(tryout);

  const handleGenerate = () => {
    generate.mutate({
      prompt,
      // Pass defaults, backend might parse prompt for teamCount
      teamCount: 2, 
      keepFriendPackages: true,
      splitGoalies: true,
    });
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
          <Card key={team.id} className="mb-3 gap-2">
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
        )})}
      </PlanGate>
    </Screen>
  );
}
