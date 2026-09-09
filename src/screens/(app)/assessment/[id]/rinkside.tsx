import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Dimensions, ScrollView, Text, View, Alert } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue, withSpring } from 'react-native-reanimated';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  ScorePad,
  Screen,
} from '@/components/ui';
import {
  useTryoutQuery,
  useSaveEvaluationMutation,
  useAthleteHistoryQuery,
  useSessionProgressQuery,
} from '@/features/queries';
import { useAssessmentId, useAssessorMode } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';
import {
  categoryAverage,
  getPlayerCategories,
  isGoaliePosition,
  playerDisplayName,
  weightedOverall,
  mapLegacyScores,
} from '@/data/rubrics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function RinksideScreen() {
  const id = useAssessmentId();
  const isAssessorOnly = useAssessorMode();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const saveEval = useSaveEvaluationMutation(id!);
  const rinksideIndex = useSessionStore((s) => s.rinksideIndex);
  const setRinksideIndex = useSessionStore((s) => s.setRinksideIndex);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const completedSessions = useSessionStore((s) => s.completedSessions);
  const markSessionCompleted = useSessionStore((s) => s.markSessionCompleted);
  const [session, setSession] = useState('Session 1');
  const [recommendation, setRecommendation] = useState<'Make' | 'Keep' | 'Bubble' | 'Release' | ''>('');
  const [isSaving, setIsSaving] = useState(false);
  const translateX = useSharedValue(0);
  const previousStateRef = useRef<string>('');
  const lastLoadedRef = useRef<{ playerId: string; session: string } | null>(null);
  const activeMutationRef = useRef<Promise<any> | null>(null);

  const roster = tryoutQuery.data?.roster ?? [];
  const player = roster[rinksideIndex];

  // Athlete history spans previous seasons, which an assessor may not see at
  // all — passing no id leaves the query disabled so it is never fetched.
  const historyQuery = useAthleteHistoryQuery(isAssessorOnly ? undefined : player?.athleteId);
  // Only an assessor needs this: a coach already has every evaluation loaded.
  const sessionProgressQuery = useSessionProgressQuery(id, isAssessorOnly);
  const sessionProgress = sessionProgressQuery.data;

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

  // Only this assessment's own evaluations may seed the score form. Session
  // labels ("Session 1") repeat across every season, so matching against the
  // athlete's history loaded last season's scores into this season's first
  // entry for a player — scoring them under the wrong season.
  const currentEvals = useMemo(
    () =>
      (tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) ?? [])
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [tryoutQuery.data?.evals, player?.id],
  );

  const highestSessionNum = useMemo(() => {
    let maxNum = (tryoutQuery.data?.evals || []).reduce((max, ev) => {
      if (!ev.session) return max;

      const hasScores = ev.scores && Object.values(ev.scores).some(val => val !== undefined && val !== null && val > 0);
      if (!hasScores) return max;

      const match = ev.session.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    const currentMatch = session?.match(/^Session (\d+)$/);
    if (currentMatch) {
      maxNum = Math.max(maxNum, parseInt(currentMatch[1], 10));
    }
    // An assessor's own read of `evals` is empty, so without the server's
    // numbering the chip strip would only ever show up to Session 5 no matter
    // how far the coach had actually gone.
    maxNum = Math.max(maxNum, sessionProgress?.[player?.id || ''] ?? 0);
    return maxNum;
  }, [tryoutQuery.data?.evals, session, sessionProgress, player?.id]);

  const SESSIONS = useMemo(() => {
    const count = Math.max(5, highestSessionNum + 1);
    const sessions = Array.from({ length: count }, (_, i) => `Session ${i + 1}`);
    sessions.push('Extra View');
    return sessions;
  }, [highestSessionNum]);

  const mostRecentEval = currentEvals[0];

  const scoredSessions = useMemo(() => {
    if (!tryoutQuery.data || !player) return new Set<string>();
    return new Set(
      (tryoutQuery.data.evals || [])
        .filter((e) => e.playerId === player.id)
        .map((e) => e.session)
    );
  }, [tryoutQuery.data?.evals, player?.id]);

  // Highest session number this player already has scored/completed data for.
  const highestDoneSessionNum = useMemo(() => {
    const completedForPlayer = completedSessions?.[player?.id || ''] || [];
    const done = [...completedForPlayer, ...Array.from(scoredSessions)];
    const fromLoadedEvals = done.reduce((max, s) => {
      const match = s?.match(/^Session (\d+)$/);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    // An assessor reads back none of the assessment's evaluations, so the
    // labels above see only what they scored in this sitting — without this
    // their first save restarted a player at Session 1 alongside the coach's
    // Sessions 1-5. The server hands over the numbering and nothing else.
    const fromServer = sessionProgress?.[player?.id || ''] ?? 0;
    return Math.max(fromLoadedEvals, fromServer);
  }, [completedSessions, scoredSessions, sessionProgress, player?.id]);

  // Default to the session *after* the last completed one (e.g. Session 3 done -> Session 4).
  // A fresh player (nothing done) defaults to Session 1.
  const defaultSessionForPlayer = useMemo(
    () => `Session ${highestDoneSessionNum + 1}`,
    [highestDoneSessionNum],
  );

  const lastPlayerIdRef = useRef<string | null>(null);

  // The default is applied once per player, so it has to wait for the session
  // numbering: settling for Session 1 and correcting afterwards would be
  // blocked by that same guard. Not loading for a coach, where this is the
  // old behaviour unchanged.
  const sessionNumberingReady = !sessionProgressQuery.isLoading;

  useEffect(() => {
    if (player?.id && sessionNumberingReady && lastPlayerIdRef.current !== player.id) {
      lastPlayerIdRef.current = player.id;
      setSession(defaultSessionForPlayer);
    }
  }, [player?.id, defaultSessionForPlayer, sessionNumberingReady]);

  // Each time the screen is (re)opened, start at the first player on a freshly-defaulted,
  // empty session. Uses focus (not mount) because the tab screen stays mounted between visits.
  // Nulling lastPlayerIdRef forces the session to re-default even when the previous visit
  // ended on this same player; clearing the recommendation/scores drops anything carried
  // over from the last scored session so the new session opens blank.
  useFocusEffect(
    useCallback(() => {
      setRinksideIndex(0);
      lastPlayerIdRef.current = null;
      setRecommendation('');
      clearWorkingScores();
    }, [setRinksideIndex, clearWorkingScores]),
  );

  useEffect(() => {
    if (!player) return;

    const lastPlayerId = lastLoadedRef.current?.playerId;
    const lastSession = lastLoadedRef.current?.session;

    if (lastPlayerId && lastSession && (lastPlayerId !== player.id || lastSession !== session)) {
      const currentStateStr = JSON.stringify({ scores: workingScores, recommendation });
      const hasUnsavedChanges = previousStateRef.current && previousStateRef.current !== currentStateStr;

      if (hasUnsavedChanges) {
        const prevPlayer = roster.find(p => p.id === lastPlayerId);
        if (prevPlayer) {
          const hasScores = workingScores && Object.values(workingScores).some(val => val !== undefined && val !== null && val > 0);
          if (hasScores) {
            const prevEval = tryoutQuery.data?.evals.find(
              e => e.playerId === lastPlayerId && e.session === lastSession
            );
            const promise = saveEval.mutateAsync({
              playerId: prevPlayer.id,
              form: { session: lastSession, scores: workingScores, recommendation },
              evalId: prevEval?.id,
            });
            activeMutationRef.current = promise;
            promise.catch(err => console.warn('Rinkside auto-save on player change failed', err))
              .finally(() => {
                if (activeMutationRef.current === promise) {
                  activeMutationRef.current = null;
                }
              });
          }
        }
      }
    }

    const isPlayerChanged = lastPlayerId !== player.id;
    const isSessionChanged = lastSession !== session;

    if (isPlayerChanged || isSessionChanged || !lastLoadedRef.current) {
      const evalForSession = currentEvals.find(e => e.session === session);
      let loadedScores = {};
      let loadedRec = '';

      if (evalForSession) {
        loadedScores = mapLegacyScores(evalForSession.scores, categories);
        loadedRec = evalForSession.recommendation || '';
      } else {
        loadedScores = mapLegacyScores({}, categories);
        loadedRec = '';
      }

      setWorkingScores(loadedScores);
      setRecommendation(loadedRec as any);
      previousStateRef.current = JSON.stringify({ scores: loadedScores, recommendation: loadedRec });
      lastLoadedRef.current = { playerId: player.id, session };
    }
  }, [player?.id, session, currentEvals]);

  const handleSessionChange = (newSession: string) => {
    setSession(newSession);
  };

  const goNext = () => {
    if (rinksideIndex < roster.length - 1) setRinksideIndex(rinksideIndex + 1);
  };
  const goPrev = () => {
    if (rinksideIndex > 0) setRinksideIndex(rinksideIndex - 1);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX < -80) runOnJS(goNext)();
      else if (e.translationX > 80) runOnJS(goPrev)();
      translateX.value = withSpring(0);
    });

  const currentStateRef = useRef({ scores: workingScores, recommendation, player, session });
  useEffect(() => {
    currentStateRef.current = { scores: workingScores, recommendation, player, session };
  }, [workingScores, recommendation, player, session]);

  useEffect(() => {
    return () => {
      const { scores, recommendation: rec, player: curPlayer, session: curSession } = currentStateRef.current;
      if (!curPlayer) return;

      const currentStateStr = JSON.stringify({ scores, recommendation: rec });
      const hasUnsavedChanges = previousStateRef.current && previousStateRef.current !== currentStateStr;

      if (hasUnsavedChanges) {
        const hasScores = scores && Object.values(scores).some(val => val !== undefined && val !== null && val > 0);
        if (hasScores) {
          const prevEval = tryoutQuery.data?.evals.find(
            e => e.playerId === curPlayer.id && e.session === curSession
          );
          saveEval.mutate({
            playerId: curPlayer.id,
            form: { session: curSession, scores, recommendation: rec },
            evalId: prevEval?.id,
          });
        }
      }
    };
  }, []);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading rinkside mode..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load evaluation." onRetry={() => tryoutQuery.refetch()} />;
  }

  if (roster.length === 0) {
    return (
      <Screen>
        <Header title="Rinkside Scoring" showBack onBack={() => navigation.navigate('AssessmentRoster')} />
        <EmptyState title="No players" message="Add players to the roster first." />
      </Screen>
    );
  }

  const overall = weightedOverall(workingScores, categories, weights);

  const saveAndNext = async () => {
    if (!player) return;

    if (activeMutationRef.current) {
      try {
        await activeMutationRef.current;
      } catch (e) {
        console.warn('Pre-saveAndNext auto-save await failed', e);
      }
    }

    const currentStateStr = JSON.stringify({ scores: workingScores, recommendation });
    const hasUnsavedChanges = previousStateRef.current !== currentStateStr;

    const getNextNavigation = () => {
      if (rinksideIndex < roster.length - 1) {
        setRinksideIndex(rinksideIndex + 1);
      } else {
        Alert.alert(
          'Finished',
          'You have reached the end of the roster.',
          [{ text: 'OK', onPress: () => navigation.navigate('AssessmentRoster') }]
        );
      }
    };

    if (!hasUnsavedChanges) {
      clearWorkingScores();
      setRecommendation('');
      getNextNavigation();
      return;
    }

    const hasScores = workingScores && Object.values(workingScores).some(val => val !== undefined && val !== null && val > 0);
    if (!hasScores) {
      clearWorkingScores();
      setRecommendation('');
      getNextNavigation();
      return;
    }
    try {
      setIsSaving(true);
      const curEval = tryoutQuery.data?.evals.find(
        e => e.playerId === player.id && e.session === session
      );
      await saveEval.mutateAsync({
        playerId: player.id,
        form: { session, scores: workingScores, recommendation },
        evalId: curEval?.id,
      });
      
      markSessionCompleted(player.id, session);
      previousStateRef.current = currentStateStr;
      clearWorkingScores();
      setRecommendation('');
      getNextNavigation();
    } catch (err: any) {
      Alert.alert('Error Saving', err.message || 'Failed to save evaluation. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header
          title="Rinkside Scoring"
          subtitle={`${rinksideIndex + 1} of ${roster.length}`}
          showBack
          onBack={() => navigation.navigate('AssessmentRoster')}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 16 }}
        >
          <View className="flex-row gap-2 mb-4">
            {(() => {
              const scoredSessionsMap = new Map((tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) || []).map(e => [e.session, e.id]));
              // Session (highestDoneSessionNum + 1) sits at this index and is the "next" one to score.
              const nextSessionIdx = highestDoneSessionNum;

              return SESSIONS.map((s, idx) => {
                const isScored = scoredSessionsMap.has(s);
                // Assessor-only: prior sessions from session progress stay
                // disabled. Managers/owners open them from loaded evals.
                const sessionNum = Number(s.match(/^Session (\d+)$/)?.[1]);
                const isServerScored =
                  Number.isFinite(sessionNum) && sessionNum <= (sessionProgress?.[player?.id || ''] ?? 0);
                let disabled = isAssessorOnly && isServerScored && !isScored;
                if (!isScored && idx > nextSessionIdx) {
                  disabled = true;
                }

                return (
                  <Chip 
                    key={s} 
                    label={s} 
                    active={session === s} 
                    disabled={disabled}
                    onPress={() => {
                      if (disabled) return;
                      handleSessionChange(s);
                    }} 
                  />
                );
              });
            })()}
          </View>
        </ScrollView>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={{ transform: [{ translateX }], width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 16 }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
          <View className="items-center py-4 gap-1">
            <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
              {player ? playerDisplayName(player) : '—'}
            </Text>
            <Text style={{ color: colors.inkMuted }}>
              #{player?.jersey ?? '—'} · {player?.pos ?? '—'}
            </Text>
            <Text className="text-3xl font-display font-bold mt-2" style={{ color: colors.primary }}>
              {overall > 0 ? overall.toFixed(1) : '—'}
            </Text>
          </View>

          {historyQuery.data && (historyQuery.data.pastSeasons.length > 0 || historyQuery.data.pastEvaluations.length > 0) && (
            <View className="mb-4 px-4 py-3 rounded border" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
              <Text className="font-display font-bold mb-2" style={{ color: colors.primary }}>
                Historical Data
              </Text>
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
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
                              <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{s.seasonName}</Text>
                              <Text style={{ color: colors.ink }}>{s.teamName}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {uniquePastEvals.length > 0 && (
                        <View className={historyQuery.data.pastSeasons.length > 0 ? "mt-2 pt-2 border-t" : ""} style={{ borderColor: colors.border }}>
                          <Text className="text-sm font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>Past Evals ({uniquePastEvals.length})</Text>
                          {uniquePastEvals.map((ev) => (
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
              </ScrollView>
            </View>
          )}

          {categories.map((cat) => {
            const catAvg = categoryAverage(workingScores, cat.subskills);
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
                    scoringType={s.scoringType}
                    rankingDirection={s.rankingDirection}
                    unit={s.unit}
                    minVal={s.minVal}
                    maxVal={s.maxVal}
                    value={workingScores[s.key]}
                    onChange={(v) => setWorkingScores({ ...workingScores, [s.key]: v })}
                  />
                ))}
              </View>
            );
          })}
          
          <View className="flex-row items-center justify-between mb-2 mt-4">
            <Text className="text-sm font-bold uppercase" style={{ color: colors.inkMuted }}>
              Recommendation
            </Text>
          </View>
          <View className="flex-row flex-wrap mb-4 gap-2">
            {(['Make', 'Keep', 'Bubble', 'Release'] as const).map((rec) => (
              <Chip
                key={rec}
                label={rec}
                active={recommendation === rec}
                onPress={() => setRecommendation(recommendation === rec ? '' : rec)}
              />
            ))}
          </View>
          </ScrollView>
        </Animated.View>
      </GestureDetector>

      <View className="px-4 pb-6 gap-2">
        <Text className="text-center text-xs" style={{ color: colors.inkFaint }}>
          Swipe left/right to change players
        </Text>
        <View className="flex-row gap-2">
          <Button label="← Prev" variant="secondary" className="flex-1" onPress={goPrev} disabled={rinksideIndex === 0 || isSaving} />
          <Button label="Save & Next →" className="flex-1" onPress={saveAndNext} loading={isSaving} />
        </View>
        <Button
          label="Full Score Form"
          variant="ghost"
          onPress={() =>
            navigation.navigate('AssessmentFlow', {
              screen: 'AssessmentScore',
              params: { id, playerId: player?.id, isAssessorOnly },
            })
          }
        />
      </View>
    </Screen>
  );
}
