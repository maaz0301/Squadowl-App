import { useState } from 'react';
import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  Header,
  LoadingState,
  ErrorState,
  Screen,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useGenerateTeamBuilderMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerNameMap, type TeamBuilderState } from '@/data/teamBuilder';

export default function TeamBuilderScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const generate = useGenerateTeamBuilderMutation(id!);
  const [teamCount, setTeamCount] = useState(2);
  const [sortMethod, setSortMethod] = useState<'snake' | 'balanced'>('snake');

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <Screen scroll>
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
      teamCount,
      sortMethod,
      keepFriendPackages: true,
      splitGoalies: true,
      teamNames: Array.from({ length: teamCount }, (_, i) => `Team ${String.fromCharCode(65 + i)}`),
    });
  };

  return (
    <Screen scroll>
      <Header title="Team Builder" subtitle="Sort Out — balanced teams" showBack />

      <PlanGate feature="teamBuilder" title="Team Builder (Club+)">
        <Card accent className="gap-3 mb-4">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Configuration
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {tryout.roster.length} players · friend packages kept together
          </Text>
          <View className="flex-row gap-2">
            {[2, 3, 4].map((n) => (
              <Chip key={n} label={`${n} teams`} active={teamCount === n} onPress={() => setTeamCount(n)} />
            ))}
          </View>
          <View className="flex-row gap-2">
            <Chip label="Snake Draft" active={sortMethod === 'snake'} onPress={() => setSortMethod('snake')} />
            <Chip label="Balanced Avg" active={sortMethod === 'balanced'} onPress={() => setSortMethod('balanced')} />
          </View>
          <Button label="Generate Teams" onPress={handleGenerate} loading={generate.isPending} />
        </Card>

        {teamBuilder?.warnings.map((w) => (
          <Badge key={w} label={w} variant="warning" />
        ))}

        {teamBuilder?.teams.map((team) => (
          <Card key={team.id} className="mb-3 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-lg font-display font-bold" style={{ color: colors.primary }}>
                {team.name}
              </Text>
              <Badge label={`${team.players.length} players`} />
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
        ))}
      </PlanGate>
    </Screen>
  );
}
