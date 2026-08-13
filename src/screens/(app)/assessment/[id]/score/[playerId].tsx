import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  Text,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';

import {
  Button,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
  ScorePad,
  Screen
} from '@/components/ui';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  mapLegacyScores,
  playerDisplayName,
  weightedOverall,
} from '@/data/rubrics';
import { RECOMMENDATIONS, ScoreFormSchema, type ScoreForm } from '@/data/types';
import { useAthleteHistoryQuery, useSaveEvaluationMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';

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

  // Same pattern as assessment/new.tsx and feedback.tsx: KeyboardAwareScrollView's
  // auto-scroll-above-keyboard logic relies on legacy measurement APIs that are
  // unreliable under the New Architecture, and this screen's category list is
  // dynamically sized, so a numeric ScorePad input anywhere in the middle of the
  // list can end up hidden behind the keyboard with no scroll ever triggering.
  // Tracking the keyboard's own height from the OS event and scrolling the
  // focused field into view ourselves needs no view measurement or native resize.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const applyHeight = (e: KeyboardEvent) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(e.endCoordinates.height);
    };
    const hide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    };
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, applyHeight);
    const hideSub = Keyboard.addListener(hideEvent, hide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const formTopRef = useRef(0);
  const fieldYRef = useRef<Record<string, number>>({});

  const rememberField = (key: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[key] = e.nativeEvent.layout.y;
  };

  const revealField = (key: string) => () => {
    const y = fieldYRef.current[key];
    if (y == null) return;
    // Wait out the keyboard-open animation so we scroll against the final,
    // already-shortened viewport rather than the full-height one.
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(formTopRef.current + y - 12, 0), animated: true });
    }, 120);
  };

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

  const { control, handleSubmit, watch, setValue, getValues, reset } = useForm<ScoreForm>({
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

        if (hasScores) {
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
          if (hasScores) {
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
    if (!hasScores) {
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
      <Screen scroll insideTabBar>
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
    <Screen scroll={false} keyboardAvoiding={false} padded={false}>
      <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
      <Header
        title={`Score: ${playerDisplayName(player)}`}
        subtitle={`Overall: ${overall > 0 ? overall.toFixed(1) : '—'}`}
        showBack
        onBack={() => navigation.navigate('AssessmentRoster')}
      />

      <View
        onLayout={(e) => {
          formTopRef.current = e.nativeEvent.layout.y;
        }}
      >


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
              <View key={s.key} onLayout={rememberField(s.key)}>
                <ScorePad
                  rubricKey={s.key}
                  label={s.label}
                  scale={s.scale}
                  scoringType={s.scoringType}
                  rankingDirection={s.rankingDirection}
                  unit={s.unit}
                  minVal={s.minVal}
                  maxVal={s.maxVal}
                  value={scores?.[s.key]}
                  onFocus={revealField(s.key)}
                  onChange={(v) => {
                    const newScores = { ...workingScores, [s.key]: v };
                    setWorkingScores(newScores);
                    setValue('scores', newScores, { shouldDirty: true });
                  }}
                />
              </View>
            ))}
          </View>
        );
      })}

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
          Recommendation
        </Text>
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

      <View onLayout={rememberField('strengths')}>
        <Controller
          control={control}
          name="strengths"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Strengths"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              onFocus={revealField('strengths')}
              multiline
              numberOfLines={3}
            />
          )}
        />
      </View>
      <View onLayout={rememberField('improve')}>
        <Controller
          control={control}
          name="improve"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Areas to Improve"
              onBlur={onBlur}
              onChangeText={onChange}
              value={value}
              onFocus={revealField('improve')}
              multiline
              numberOfLines={3}
            />
          )}
        />
      </View>

      <View className="py-4 gap-2">
        <Text className="text-center text-2xl font-display font-bold" style={{ color: colors.primary }}>
          Overall: {overall > 0 ? overall.toFixed(1) : '—'}
        </Text>
        <Button label="Done" onPress={onSubmit} loading={saving} />
      </View>
      </View>
        </ScrollView>
      </View>
    </Screen>
  );
}
