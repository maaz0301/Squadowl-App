import { useEffect, useMemo, useState, useRef } from 'react';
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

  const initialScores = mapLegacyScores(existingEval?.scores ?? {}, categories);

  const { control, handleSubmit, watch, setValue, getValues } = useForm<ScoreForm>({
    resolver: zodResolver(ScoreFormSchema),
    defaultValues: {
      session: nextSession,
      strengths: existingEval?.strengths ?? '',
      improve: existingEval?.improve ?? '',
      recommendation: existingEval?.recommendation ?? '',
      scores: initialScores,
    },
  });

  const scores = watch('scores');
  const formData = watch();
  const previousFormRef = useRef<string>('');

  const loadEvalData = (targetEvalId?: string, fallbackSession?: string, preserveWorkingScores: boolean = false) => {
    const targetEval = targetEvalId
      ? tryoutQuery.data?.evals.find((e) => e.id === targetEvalId)
      : undefined;

    const scoresToSet = targetEval
      ? mapLegacyScores(targetEval.scores ?? {}, categories)
      : (preserveWorkingScores && Object.keys(workingScores).length > 0 ? workingScores : mapLegacyScores({}, categories));

    setWorkingScores(scoresToSet);
    setValue('scores', scoresToSet);
    setValue('session', targetEval?.session ?? fallbackSession ?? nextSession);
    setValue('strengths', targetEval?.strengths ?? '');
    setValue('improve', targetEval?.improve ?? '');
    setValue('recommendation', targetEval?.recommendation ?? '');
    
    // Defer the ref update slightly to ensure React Hook Form's watch state is updated
    setTimeout(() => {
      previousFormRef.current = JSON.stringify(getValues()); 
    }, 0);
  };

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (!tryoutQuery.data || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    loadEvalData(evalId, undefined, true);
  }, [tryoutQuery.data?.id]);

  useEffect(() => {
    setValue('scores', workingScores);
  }, [workingScores]);

  useEffect(() => {
    const currentFormStr = JSON.stringify(formData);
    if (previousFormRef.current === currentFormStr || previousFormRef.current === '') {
      if (previousFormRef.current === '') {
        previousFormRef.current = currentFormStr;
      }
      return;
    }

    const hasScores = formData.scores && Object.values(formData.scores).some(val => val !== undefined && val !== null && val > 0);
    if (!hasScores) {
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const result = await saveEval.mutateAsync({
          playerId: playerId!,
          form: formData,
          evalId: evalId ?? undefined,
        });
        
        if (!evalId && result.id) {
          navigation.setParams({ evalId: result.id });
        }
        previousFormRef.current = JSON.stringify(formData);
      } catch (err) {
        console.warn('Auto-save failed', err);
      }
    }, 1500);

    return () => clearTimeout(timeout);
  }, [formData, evalId, playerId]);

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
      const hasScores = data.scores && Object.values(data.scores).some(val => val !== undefined && val !== null && val > 0);
      if (!hasScores) {
        Alert.alert('No scores entered', 'Please grade at least one subskill before saving.');
        return;
      }

      await saveEval.mutateAsync({
        playerId: playerId!,
        form: data,
        evalId: evalId ?? undefined,
      });

      // Navigate to the next unscored session if available
      const unscoredSessions = SESSIONS.filter(s => !scoredSessions.has(s) && s !== data.session);
      
      if (unscoredSessions.length > 0) {
        const nextUnscored = unscoredSessions[0];
        navigation.setParams({ evalId: undefined });
        loadEvalData(undefined, nextUnscored);
      } else {
        clearWorkingScores();
        navigation.goBack();
      }
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
                let targetId;
                if (scoredSessions.has(s)) {
                  targetId = scoredSessions.get(s);
                  navigation.setParams({ evalId: targetId });
                } else {
                  targetId = undefined;
                  navigation.setParams({ evalId: undefined });
                }
                loadEvalData(targetId, s);
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
          Overall: {overall > 0 ? overall.toFixed(1) : '—'}
        </Text>
        <Button label="Done" onPress={onSubmit} loading={saveEval.isPending} />
      </View>
    </Screen>
  );
}
