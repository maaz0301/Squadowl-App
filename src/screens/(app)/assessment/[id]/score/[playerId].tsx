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
  const { playerId, evalId, session: routeSession } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [saving, setSaving] = useState(false);
  const tryoutQuery = useTryoutQuery(id);
  const saveEval = useSaveEvaluationMutation(id!);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const activeAssessor = useSessionStore((s) => s.activeAssessor);
  const setActiveAssessor = useSessionStore((s) => s.setActiveAssessor);
  const completedSessions = useSessionStore((s) => s.completedSessions);
  const markSessionCompleted = useSessionStore((s) => s.markSessionCompleted);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeMutationRef = useRef<Promise<any> | null>(null);

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
  const baseHighestSessionNum = useMemo(() => {
    return (tryoutQuery.data?.evals || []).reduce((max, ev) => {
      if (!ev.session) return max;
      
      const hasScores = ev.scores && Object.values(ev.scores).some(val => val !== undefined && val !== null && val > 0);
      if (!hasScores) return max;

      const match = ev.session.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
  }, [tryoutQuery.data?.evals]);

  const highestSessionNum = useMemo(() => {
    let maxNum = baseHighestSessionNum;
    const match = routeSession?.match(/^Session (\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    return maxNum;
  }, [baseHighestSessionNum, routeSession]);

  const SESSIONS = useMemo(() => {
    const count = Math.max(5, highestSessionNum + 1);
    const sessions = Array.from({ length: count }, (_, i) => `Session ${i + 1}`);
    sessions.push('Extra View');
    return sessions;
  }, [highestSessionNum]);
  const completedSessionsForPlayer = useMemo(() => {
    return completedSessions?.[playerId || ''] || [];
  }, [completedSessions, playerId]);
  const nextSession = existingEval?.session ?? SESSIONS.find(s => !completedSessionsForPlayer.includes(s) && !scoredSessions.has(s) && s !== 'Extra View') ?? 'Session 1';
  const currentSession = routeSession ?? nextSession;

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

  const { control, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<ScoreForm>({
    resolver: zodResolver(ScoreFormSchema),
    defaultValues: {
      session: currentSession,
      strengths: existingEval?.strengths ?? '',
      improve: existingEval?.improve ?? '',
      recommendation: existingEval?.recommendation ?? '',
      scores: initialScores,
    },
  });

  const scores = watch('scores');
  const formData = watch();
  const previousFormRef = useRef<string>('');
  const lastLoadedRef = useRef<{ playerId: string; evalId?: string; session?: string } | null>(null);

  const loadEvalData = (targetEvalId?: string | null, targetSession?: string, preserveWorkingScores: boolean = false) => {
    activeMutationRef.current = null;
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    const currentSess = targetSession ?? currentSession;
    if (playerId) {
      lastLoadedRef.current = { playerId, evalId: targetEvalId ?? undefined, session: currentSess };
    }

    const targetEval = targetEvalId
      ? tryoutQuery.data?.evals.find((e) => e.id === targetEvalId && e.session === currentSess)
      : undefined;

    const scoresToSet = targetEval
      ? mapLegacyScores(targetEval.scores ?? {}, categories)
      : (preserveWorkingScores && Object.keys(workingScores).length > 0 ? workingScores : mapLegacyScores({}, categories));

    setWorkingScores(scoresToSet);

    const currentValues = getValues();
    const newValues = {
      session: targetEval?.session ?? currentSess,
      strengths: preserveWorkingScores ? currentValues.strengths : (targetEval?.strengths ?? ''),
      improve: preserveWorkingScores ? currentValues.improve : (targetEval?.improve ?? ''),
      recommendation: preserveWorkingScores ? currentValues.recommendation : (targetEval?.recommendation ?? ''),
      scores: scoresToSet,
    };

    reset(newValues);
    previousFormRef.current = JSON.stringify(newValues);
  };

  useEffect(() => {
    if (!tryoutQuery.data || !playerId) return;

    const lastPlayerId = lastLoadedRef.current?.playerId;
    const lastEvalId = lastLoadedRef.current?.evalId;
    const lastSession = lastLoadedRef.current?.session;

    const isPlayerChanged = lastPlayerId && lastPlayerId !== playerId;
    const isSessionChanged = lastPlayerId && lastSession !== currentSession;
    // Only reload if we switched from one non-null evaluation ID to a different non-null ID.
    // Transitioning from undefined/null to a non-null ID (due to save/autosave completion) should not reload or reset.
    const isEvalSwitched = lastPlayerId && lastEvalId && evalId && lastEvalId !== evalId;

    if (isPlayerChanged || isSessionChanged || isEvalSwitched) {
      const currentFormVal = getValues();
      const currentFormStr = JSON.stringify(currentFormVal);
      const hasUnsaved = previousFormRef.current && previousFormRef.current !== currentFormStr;

      if (hasUnsaved) {
        const prevPlayerId = lastPlayerId || playerId;
        const prevEvalId = lastEvalId;
        const prevSession = lastSession;

        const hasScores = currentFormVal.scores && Object.values(currentFormVal.scores).some(val => val !== undefined && val !== null && val > 0);

        if (hasScores && currentFormVal.recommendation) {
          saveEval.mutate({
            playerId: prevPlayerId,
            form: { ...currentFormVal, session: prevSession || currentFormVal.session },
            evalId: prevEvalId ?? undefined,
          });
        }
      }

      const shouldPreserve = !isPlayerChanged && !isSessionChanged;

      lastLoadedRef.current = { playerId, evalId: evalId ?? undefined, session: currentSession };
      loadEvalData(evalId, currentSession, shouldPreserve);
    } else {
      // Just update the lastLoadedRef with the current parameters without reloading or resetting the form
      lastLoadedRef.current = { playerId, evalId: evalId ?? undefined, session: currentSession };
    }
  }, [tryoutQuery.data, playerId, evalId, currentSession]);

  useEffect(() => {
    setValue('scores', workingScores);
  }, [workingScores]);

  const currentFormRef = useRef<{ form: ScoreForm; playerId: string; evalId?: string | null; session: string } | null>(null);
  useEffect(() => {
    currentFormRef.current = { form: formData, playerId, evalId: evalId ?? null, session: currentSession };
  }, [formData, playerId, evalId, currentSession]);

  useEffect(() => {
    return () => {
      if (currentFormRef.current) {
        const { form, playerId: pId, evalId: eId, session: sName } = currentFormRef.current;
        const currentFormStr = JSON.stringify(form);
        const hasUnsaved = previousFormRef.current && previousFormRef.current !== currentFormStr;
        if (hasUnsaved) {
          const hasScores = form.scores && Object.values(form.scores).some(val => val !== undefined && val !== null && val > 0);
          if (hasScores && form.recommendation) {
            saveEval.mutate({
              playerId: pId,
              form: { ...form, session: sName },
              evalId: eId ?? undefined,
            });
          }
        }
      }
    };
  }, []);

  useEffect(() => {
    const currentFormStr = JSON.stringify(formData);
    if (previousFormRef.current === currentFormStr || previousFormRef.current === '') {
      if (previousFormRef.current === '') {
        previousFormRef.current = currentFormStr;
      }
      return;
    }

    const hasScores = formData.scores && Object.values(formData.scores).some(val => val !== undefined && val !== null && val > 0);
    if (!hasScores || !formData.recommendation) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      const mutationPromise = saveEval.mutateAsync({
        playerId: playerId!,
        form: formData,
        evalId: evalId ?? undefined,
      });
      activeMutationRef.current = mutationPromise;

      try {
        const result = await mutationPromise;
        if (activeMutationRef.current === mutationPromise) {
          if (!evalId && result.id) {
            navigation.setParams({ evalId: result.id });
          }
          previousFormRef.current = JSON.stringify(formData);
        }
      } catch (err) {
        console.warn('Auto-save failed', err);
      } finally {
        if (activeMutationRef.current === mutationPromise) {
          activeMutationRef.current = null;
        }
      }
    }, 1500);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
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
      setSaving(true);
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }

      if (activeMutationRef.current) {
        try {
          const result = await activeMutationRef.current;
          if (!evalId && result?.id) {
            navigation.setParams({ evalId: result.id });
          }
        } catch (e) {
          console.warn('Pre-submit auto-save await failed', e);
        }
      }

      const currentFormStr = JSON.stringify(data);
      const hasUnsavedChanges = previousFormRef.current !== currentFormStr;

      if (hasUnsavedChanges) {
        const hasScores = data.scores && Object.values(data.scores).some(val => val !== undefined && val !== null && val > 0);
        if (!hasScores) {
          Alert.alert('No scores entered', 'Please grade at least one subskill before saving.');
          setSaving(false);
          return;
        }

        await saveEval.mutateAsync({
          playerId: playerId!,
          form: data,
          evalId: evalId ?? undefined,
        });
        previousFormRef.current = currentFormStr;
      }

      if (playerId) {
        markSessionCompleted(playerId, data.session);
      }

      const currentIdx = SESSIONS.indexOf(data.session);
      if (currentIdx !== -1 && currentIdx < SESSIONS.length - 1) {
        const nextSess = SESSIONS[currentIdx + 1];
        const nextEvalId = scoredSessions.get(nextSess) || null;
        navigation.setParams({ evalId: nextEvalId, session: nextSess });
      } else {
        clearWorkingScores();
        navigation.goBack();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save evaluation.');
    } finally {
      setSaving(false);
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 16 }}
      >
        <View className="flex-row gap-2 mb-4">
          {SESSIONS.map((s, idx) => {
            const isScored = scoredSessions.has(s);
            const isCurrentOfEval = isEditing && existingEval?.session === s;

            let disabled = false;
            if (isScored) {
              disabled = false; // allow editing
            } else if (firstUnscoredIdx !== -1 && idx > firstUnscoredIdx) {
              disabled = true;
            }

            return (
              <Chip
                key={s}
                label={s}
                active={currentSession === s}
                disabled={disabled}
                onPress={() => {
                  if (disabled) return;

                  let targetId;
                  if (scoredSessions.has(s)) {
                    targetId = scoredSessions.get(s);
                  } else {
                    targetId = null;
                  }

                  navigation.setParams({ evalId: targetId, session: s });
                }}
              />
            );
          })}
        </View>
      </ScrollView>

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
                  const newScores = { ...workingScores, [s.key]: v };
                  setWorkingScores(newScores);
                  setValue('scores', newScores, { shouldDirty: true });
                }}
              />
            ))}
          </View>
        );
      })}

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
          Recommendation *
        </Text>
        {errors.recommendation && (
          <Text className="text-sm font-medium" style={{ color: colors.danger }}>
            {errors.recommendation.message}
          </Text>
        )}
      </View>
      <Controller
        control={control}
        name="recommendation"
        render={({ field: { value, onChange } }) => (
          <View className="flex-row flex-wrap mb-4 gap-2">
            {RECOMMENDATIONS.filter(Boolean).map((rec) => (
              <Chip
                key={rec}
                label={rec}
                active={value === rec}
                onPress={() => onChange(value === rec ? '' : rec)}
              />
            ))}
          </View>
        )}
      />

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
        <Button label="Done" onPress={onSubmit} loading={saving} />
      </View>
    </Screen>
  );
}
