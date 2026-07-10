import { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

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
import { useTryoutQuery, useSaveEvaluationMutation, useAthleteHistoryQuery } from '@/features/queries';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function RinksideScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const saveEval = useSaveEvaluationMutation(id!);
  const rinksideIndex = useSessionStore((s) => s.rinksideIndex);
  const setRinksideIndex = useSessionStore((s) => s.setRinksideIndex);
  const workingScores = useSessionStore((s) => s.workingScores);
  const setWorkingScores = useSessionStore((s) => s.setWorkingScores);
  const clearWorkingScores = useSessionStore((s) => s.clearWorkingScores);
  const [session, setSession] = useState('Session 1');
  const translateX = useSharedValue(0);

  const roster = tryoutQuery.data?.roster ?? [];
  const player = roster[rinksideIndex];

  const historyQuery = useAthleteHistoryQuery(player?.athleteId);

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

  const previousEvals = useMemo(() => {
    const current = tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) || [];
    const past = historyQuery.data?.pastEvaluations || [];
    return [...current, ...past].sort((a, b) => b.createdAt - a.createdAt);
  }, [tryoutQuery.data?.evals, historyQuery.data?.pastEvaluations, player?.id]);

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

  const mostRecentEval = previousEvals[0];

  useEffect(() => {
    const defaultSession = mostRecentEval?.session && SESSIONS.includes(mostRecentEval.session) 
      ? mostRecentEval.session 
      : 'Session 1';
    
    setSession(defaultSession);

    if (mostRecentEval?.scores) {
      setWorkingScores(mapLegacyScores(mostRecentEval.scores, categories));
    } else {
      clearWorkingScores();
    }
  }, [player?.id, mostRecentEval?.id]);

  const handleSessionChange = (newSession: string) => {
    setSession(newSession);
    const evalForSession = previousEvals.find(e => e.session === newSession);
    if (evalForSession?.scores) {
      setWorkingScores(mapLegacyScores(evalForSession.scores, categories));
    } else {
      clearWorkingScores();
    }
  };

  const goNext = () => {
    if (rinksideIndex < roster.length - 1) setRinksideIndex(rinksideIndex + 1);
  };
  const goPrev = () => {
    if (rinksideIndex > 0) setRinksideIndex(rinksideIndex - 1);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX < -80) runOnJS(goNext)();
      else if (e.translationX > 80) runOnJS(goPrev)();
      translateX.value = withSpring(0);
    });

  if (tryoutQuery.isLoading) return <LoadingState message="Loading rinkside mode..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load assessment." onRetry={() => tryoutQuery.refetch()} />;
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
    await saveEval.mutateAsync({
      playerId: player.id,
      form: { session, scores: workingScores, recommendation: '' },
    });
    clearWorkingScores();
    if (rinksideIndex < roster.length - 1) setRinksideIndex(rinksideIndex + 1);
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
        <View className="flex-row flex-wrap mb-2">
          {(() => {
            const scoredSessions = new Map((tryoutQuery.data?.evals.filter((e) => e.playerId === player?.id) || []).map(e => [e.session, e.id]));
            const firstUnscoredIdx = SESSIONS.findIndex(s => !scoredSessions.has(s));
            
            return SESSIONS.map((s, idx) => {
              const isScored = scoredSessions.has(s);
              let disabled = false;
              if (!isScored && firstUnscoredIdx !== -1 && idx > firstUnscoredIdx) {
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
                    value={workingScores[s.key]}
                    onChange={(v) => setWorkingScores({ ...workingScores, [s.key]: v })}
                  />
                ))}
              </View>
            );
          })}
          </ScrollView>
        </Animated.View>
      </GestureDetector>

      <View className="px-4 pb-6 gap-2">
        <Text className="text-center text-xs" style={{ color: colors.inkFaint }}>
          Swipe left/right to change players
        </Text>
        <View className="flex-row gap-2">
          <Button label="← Prev" variant="secondary" className="flex-1" onPress={goPrev} disabled={rinksideIndex === 0} />
          <Button label="Save & Next →" className="flex-1" onPress={saveAndNext} loading={saveEval.isPending} />
        </View>
        <Button
          label="Full Score Form"
          variant="ghost"
          onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentScore', params: { id, playerId: player?.id } })}
        />
      </View>
    </Screen>
  );
}
