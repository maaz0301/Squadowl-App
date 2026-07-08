import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ScoreFormSchema, RECOMMENDATIONS, type ScoreForm } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  ScorePad,
  Screen,
  Badge,
} from '@/components/ui';
import { useTryoutQuery, useSaveEvaluationMutation, useSeasonsQuery, useAddSeasonPlayerMutation, useAthleteHistoryQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  playerDisplayName,
  weightedOverall,
  mapLegacyScores,
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
  const historyQuery = useAthleteHistoryQuery(player?.athleteId);
  const existingEval = evalId
    ? tryoutQuery.data?.evals.find((e) => e.id === evalId)
    : undefined;

  const previousEvals = useMemo(() => {
    const current = tryoutQuery.data?.evals.filter((e) => e.playerId === playerId) || [];
    const past = historyQuery.data?.pastEvaluations || [];
    return [...current, ...past].sort((a, b) => b.createdAt - a.createdAt);
  }, [tryoutQuery.data?.evals, historyQuery.data?.pastEvaluations, playerId]);

  const mostRecentEval = previousEvals[0];
  const scoredSessions = new Map((tryoutQuery.data?.evals.filter((e) => e.playerId === playerId) || []).map(e => [e.session, e.id]));
  const highestSessionNum = useMemo(() => {
    return (tryoutQuery.data?.evals || []).reduce((max, ev) => {
      if (!ev.session) return max;
      const match = ev.session.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
  }, [tryoutQuery.data?.evals]);

  const SESSIONS = useMemo(() => {
    const count = Math.max(5, highestSessionNum + 1);
    const sessions = Array.from({ length: count }, (_, i) => `Session ${i + 1}`);
    sessions.push('Extra View');
    return sessions;
  }, [highestSessionNum]);
  const nextSession = existingEval?.session ?? SESSIONS.find(s => !scoredSessions.has(s)) ?? 'Session 1';

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

  const initialScores = mapLegacyScores(existingEval?.scores ?? mostRecentEval?.scores ?? {}, categories);

  const { control, handleSubmit, watch, setValue } = useForm<ScoreForm>({
    resolver: zodResolver(ScoreFormSchema),
    defaultValues: {
      session: nextSession,
      strengths: existingEval?.strengths ?? mostRecentEval?.strengths ?? '',
      improve: existingEval?.improve ?? mostRecentEval?.improve ?? '',
      recommendation: existingEval?.recommendation ?? mostRecentEval?.recommendation ?? '',
      scores: initialScores,
    },
  });

  const scores = watch('scores');

  useEffect(() => {
    const scores = mapLegacyScores(existingEval?.scores ?? mostRecentEval?.scores ?? {}, categories);
    setWorkingScores(scores);
    setValue('session', existingEval?.session ?? nextSession);
    setValue('strengths', existingEval?.strengths ?? mostRecentEval?.strengths ?? '');
    setValue('improve', existingEval?.improve ?? mostRecentEval?.improve ?? '');
    setValue('recommendation', existingEval?.recommendation ?? mostRecentEval?.recommendation ?? '');
    return () => clearWorkingScores();
  }, [evalId, mostRecentEval?.id]); // re-run if history loads late

  useEffect(() => {
    setValue('scores', workingScores);
  }, [workingScores]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError) {
    return (
      <Screen scroll>
        <Header title="Score" showBack onBack={() => navigation.navigate('AssessmentRoster')} />
        <ErrorState message="Could not load required data." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }
  if (!player || !tryoutQuery.data) {
    return <ErrorState message="Player not found." onRetry={() => tryoutQuery.refetch()} />;
  }

  const overall = weightedOverall(scores ?? {}, categories, weights);

  const onSubmit = handleSubmit(async (data) => {
    try {
      await saveEval.mutateAsync({
        playerId: playerId!,
        form: data,
        evalId: evalId ?? undefined,
      });
      clearWorkingScores();
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save evaluation.');
    }
  });

  const isEditing = !!evalId;
  const firstUnscoredIdx = SESSIONS.findIndex(s => !scoredSessions.has(s));

  return (
    <Screen scroll>
      <Header 
        title={`Score: ${playerDisplayName(player)}`} 
        subtitle={`Overall: ${overall > 0 ? overall.toFixed(1) : '—'}`} 
        showBack 
        onBack={() => navigation.navigate('AssessmentRoster')}
      />

      {historyQuery.data && (historyQuery.data.pastSeasons.length > 0 || historyQuery.data.pastEvaluations.length > 0) && (
        <Card className="mb-4 gap-2 border-brand">
          <Text className="font-display font-bold" style={{ color: colors.primary }}>
            Historical Data
          </Text>
          {(() => {
            const uniquePastEvals = Object.values(
              historyQuery.data.pastEvaluations.reduce((acc, ev) => {
                const key = `${ev.session}-${ev.evaluator}`;
                if (!acc[key] || acc[key].createdAt < ev.createdAt) {
                  acc[key] = ev;
                }
                return acc;
              }, {} as Record<string, typeof historyQuery.data.pastEvaluations[0]>)
            ).sort((a, b) => a.createdAt - b.createdAt);

            return (
              <>
                {historyQuery.data.pastSeasons.length > 0 && (
                  <View>
                    <Text className="text-sm font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Past Seasons</Text>
                    {historyQuery.data.pastSeasons.map((s) => (
                      <View key={s.seasonId} className="flex-row items-center gap-2 mb-1">
                        <Badge label={s.seasonName} variant="info" />
                        <Text style={{ color: colors.ink }}>{s.teamName}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {uniquePastEvals.length > 0 && (
                  <View className={historyQuery.data.pastSeasons.length > 0 ? "mt-2 pt-2 border-t" : ""} style={{ borderColor: colors.border }}>
                    <Text className="text-sm font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Past Evals ({uniquePastEvals.length})</Text>
                    {uniquePastEvals.map((ev, i) => (
                      <View key={ev.id} className="mb-1 border-b pb-1" style={{ borderColor: colors.border }}>
                        <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                          {ev.session} · {ev.recommendation || 'No Rec'}
                        </Text>
                        {ev.strengths ? <Text className="text-xs" style={{ color: colors.success }}>+ {ev.strengths}</Text> : null}
                        {ev.improve ? <Text className="text-xs" style={{ color: colors.inkMuted }}>→ {ev.improve}</Text> : null}
                        {Object.keys(ev.scores || {}).length > 0 && (
                          <Text className="text-xs mt-1 font-bold" style={{ color: colors.primary }}>
                            {categories
                              .map((cat) => {
                                const avg = categoryAverage(ev.scores, cat.subskills);
                                return avg !== null ? `${cat.label} ${avg.toFixed(1)}` : null;
                              })
                              .filter(Boolean)
                              .join('  ·  ')}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </>
            );
          })()}
        </Card>
      )}

      {tryoutQuery.data.assessors.length > 0 ? (
        <View className="mb-4">
          <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
            Scoring as
          </Text>
          <View className="flex-row flex-wrap">
            {tryoutQuery.data.assessors.map((a, i) => {
              const isActive = activeAssessor?.name === a.name && activeAssessor?.email === a.email;
              return (
                <Chip
                  key={`${a.name}-${a.email}-${i}`}
                  label={a.name}
                  active={isActive}
                  onPress={() => setActiveAssessor(isActive ? null : a)}
                />
              );
            })}
          </View>
          {activeAssessor ? (
            <Text className="text-sm mt-1" style={{ color: colors.inkFaint }}>
              Evaluations tagged to {activeAssessor.name}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2 mb-4">
        {SESSIONS.map((s, idx) => {
          const isScored = scoredSessions.has(s);
          const isCurrentOfEval = isEditing && existingEval?.session === s;
          
          let disabled = false;
          if (isScored) {
             disabled = false; // Never disable scored sessions so they can tap to edit!
          } else if (firstUnscoredIdx !== -1 && idx > firstUnscoredIdx) {
             disabled = true;
          }

          return (
            <Chip
              key={s}
              label={s}
              active={watch('session') === s}
              disabled={disabled}
              onPress={() => {
                if (disabled) return;
                if (scoredSessions.has(s)) {
                  navigation.setParams({ evalId: scoredSessions.get(s) });
                } else {
                  navigation.setParams({ evalId: undefined });
                  setValue('session', s);
                }
              }}
            />
          );
        })}
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
