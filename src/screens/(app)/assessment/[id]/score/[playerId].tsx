import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ScoreFormSchema, RECOMMENDATIONS, type ScoreForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
  ScorePad,
  Screen,
} from '@/components/ui';
import { useTryoutQuery, useSaveEvaluationMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  playerDisplayName,
  weightedOverall,
} from '@/data/rubrics';

export default function ScoreScreen() {
  const id = useAssessmentId();
  const route = useRoute<any>();
  const { playerId, evalId } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const saveEval = useSaveEvaluationMutation(id!);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);

  const player = tryoutQuery.data?.roster.find((p) => p.id === playerId);
  const existingEval = evalId
    ? tryoutQuery.data?.evals.find((e) => e.id === evalId)
    : tryoutQuery.data?.evals
        .filter((e) => e.playerId === playerId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

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

  const { control, handleSubmit, watch, setValue } = useForm<ScoreForm>({
    resolver: zodResolver(ScoreFormSchema),
    defaultValues: {
      session: existingEval?.session ?? 'Session 1',
      strengths: existingEval?.strengths ?? '',
      improve: existingEval?.improve ?? '',
      recommendation: existingEval?.recommendation ?? '',
      scores: existingEval?.scores ?? {},
    },
  });

  const scores = watch('scores');

  useEffect(() => {
    if (existingEval?.scores) setWorkingScores(existingEval.scores);
    return () => clearWorkingScores();
  }, [existingEval?.id]);

  useEffect(() => {
    setValue('scores', workingScores);
  }, [workingScores]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError) {
    return (
      <Screen scroll>
        <Header title="Score" showBack />
        <ErrorState message="Could not load required data." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }
  if (!player || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  const overall = weightedOverall(scores ?? {}, categories, weights);

  const onSubmit = handleSubmit(async (data) => {
    await saveEval.mutateAsync({
      playerId: playerId!,
      form: data,
      evalId: evalId ?? undefined,
    });
    clearWorkingScores();
    navigation.goBack();
  });

  return (
    <Screen scroll>
      <Header title={`Score: ${playerDisplayName(player)}`} subtitle={`Overall: ${overall > 0 ? overall.toFixed(1) : '—'}`} showBack />

      {tryoutQuery.data.assessors.length > 0 ? (
        <View className="mb-4">
          <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
            Scoring as
          </Text>
          <View className="flex-row flex-wrap">
            {tryoutQuery.data.assessors.map((a, i) => (
              <Chip
                key={`${a.name}-${i}`}
                label={a.name}
                active={activeAssessor === a.name}
                onPress={() => setActiveAssessor(a.name)}
              />
            ))}
          </View>
          {activeAssessor ? (
            <Text className="text-sm mt-1" style={{ color: colors.inkFaint }}>
              Evaluations tagged to {activeAssessor}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="flex-row flex-wrap mb-4">
        {(['Session 1', 'Session 2', 'Session 3', 'Extra View'] as const).map((s) => (
          <Chip
            key={s}
            label={s}
            active={watch('session') === s}
            onPress={() => setValue('session', s)}
          />
        ))}
      </View>

      {categories.map((cat) => {
        const catAvg = categoryAverage(scores ?? {}, cat.subskills);
        return (
          <View key={cat.key} className="mb-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
                {cat.label}
              </Text>
              <Text className="text-sm font-bold" style={{ color: colors.primary }}>
                {catAvg !== null ? catAvg.toFixed(1) : '—'}
              </Text>
            </View>
            {cat.subskills.map((s) => (
              <ScorePad
                key={s.key}
                rubricKey={s.key}
                label={s.label}
                scale={s.scale}
                value={scores?.[s.key]}
                onChange={(v) => {
                  setWorkingScores({ ...workingScores, [s.key]: v });
                }}
              />
            ))}
          </View>
        );
      })}

      <Text className="text-sm font-bold uppercase mb-2" style={{ color: colors.inkMuted }}>
        Recommendation
      </Text>
      <View className="flex-row flex-wrap mb-4">
        {RECOMMENDATIONS.filter(Boolean).map((rec) => (
          <Chip
            key={rec}
            label={rec}
            active={watch('recommendation') === rec}
            onPress={() => setValue('recommendation', rec)}
          />
        ))}
      </View>

      <Controller
        control={control}
        name="strengths"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Strengths" onBlur={onBlur} onChangeText={onChange} value={value} multiline numberOfLines={3} />
        )}
      />
      <Controller
        control={control}
        name="improve"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input label="Areas to Improve" onBlur={onBlur} onChangeText={onChange} value={value} multiline numberOfLines={3} />
        )}
      />

      <View className="py-4 gap-2">
        <Text className="text-center text-2xl font-display font-bold" style={{ color: colors.primary }}>
          Overall: {overall > 0 ? overall.toFixed(2) : '—'}
        </Text>
        <Button label="Save Evaluation" onPress={onSubmit} loading={saveEval.isPending} />
      </View>
    </Screen>
  );
}
