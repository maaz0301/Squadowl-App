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

  useEffect(() => {
    clearWorkingScores();
  }, [player?.id]);

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
        <Header title="Rinkside Scoring" showBack />
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
        />
        <View className="flex-row flex-wrap mb-2">
          {(['Session 1', 'Session 2', 'Extra View'] as const).map((s) => (
            <Chip key={s} label={s} active={session === s} onPress={() => setSession(s)} />
          ))}
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
