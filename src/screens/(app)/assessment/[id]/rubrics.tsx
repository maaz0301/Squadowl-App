import { useState } from 'react';
import { Text, View, Alert, Pressable, Platform, Switch } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Chip, ErrorState, Header, Input, LoadingState, Screen, Badge } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { useTryoutQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import {
  SCORING_TYPE_LABELS,
  binaryLabels,
  isBinaryScoringType,
  isMetricScoringType,
  resolveWeights,
} from '@/data/rubrics';
import { SCORING_TYPES, type ScoringType, type RankingDirection } from '@/data/types';
import { benchmarkMax, canHaveBenchmark, formatBenchmarkValue, isValidBenchmark } from '@/data/benchmarks';
import { moveItem } from '@/lib/reorder';
import { parseTimeText } from '@/lib/timeEntry';

/** Weights print as whole percentages where they are whole, e.g. "25%" / "16.7%". */
function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export default function RubricsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();

  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [scoringType, setScoringType] = useState<ScoringType>('skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>('1-5');
  const [unit, setUnit] = useState('');
  const [minValStr, setMinValStr] = useState('');
  const [maxValStr, setMaxValStr] = useState('');
  const [rankingDirection, setRankingDirection] = useState<RankingDirection>('higher_is_better');
  const [weightStr, setWeightStr] = useState('');
  // An optional target shown beside players' results, with a short explanation.
  const [benchmarkOn, setBenchmarkOn] = useState(false);
  const [benchmarkStr, setBenchmarkStr] = useState('');
  const [benchmarkNote, setBenchmarkNote] = useState('');
  // Key of the rubric being edited. Its key never changes, so saved scores and
  // weights stay attached to it; the type and scale are fixed for the same reason.
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const handleScoringTypeChange = (type: ScoringType) => {
    if (editingKey) return;
    setScoringType(type);
    if (type === 'time') {
      setRankingDirection('lower_is_better');
    } else {
      setRankingDirection('higher_is_better');
    }
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  const weightNum = weightStr.trim() !== '' ? parseFloat(weightStr) : undefined;
  const weightValid = weightNum == null || (!isNaN(weightNum) && weightNum >= 1 && weightNum <= 100);
  // A time rubric also takes a clock reading ("1:30"), turned into its own unit.
  const readNumber = (text: string) => (scoringType === 'time' ? parseTimeText(text, unit.trim() || 'sec') : parseFloat(text));
  const benchmarkNum = benchmarkStr.trim() !== '' ? readNumber(benchmarkStr) : undefined;
  const benchmarkActive = benchmarkOn && canHaveBenchmark(scoringType);
  const benchmarkValid = !benchmarkActive || isValidBenchmark({ scoringType, scale }, benchmarkNum);

  if (tryoutQuery.isLoading || !id) return <LoadingState message="Loading rubrics..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <ErrorState message="Could not load rubrics." onRetry={() => tryoutQuery.refetch()} />
    );
  }

  const tryout = tryoutQuery.data;
  const custom = tryout.settings.customRubrics ?? [];
  const existingCategories = Array.from(new Set(custom.map((r) => r.category).filter((c): c is string => !!c)));
  const plan = getPlanDefinition(tier);
  const customLimit = plan.limits.customRubrics;
  const atCustomLimit =
    customLimit !== 'unlimited' && custom.length >= (customLimit as number);

  const resetForm = () => {
    setEditingKey(null);
    setLabel('');
    setUnit('');
    setMinValStr('');
    setMaxValStr('');
    setWeightStr('');
    setBenchmarkOn(false);
    setBenchmarkStr('');
    setBenchmarkNote('');
  };

  const startEdit = (r: (typeof custom)[number]) => {
    setEditingKey(r.key);
    setLabel(r.label);
    setCategory(r.category ?? '');
    setScoringType(r.scoringType ?? 'skill');
    setScale(r.scale === '1-10' ? '1-10' : '1-5');
    setUnit(r.unit ?? '');
    setMinValStr(r.minVal != null ? String(r.minVal) : '');
    setMaxValStr(r.maxVal != null ? String(r.maxVal) : '');
    setRankingDirection(r.rankingDirection ?? 'higher_is_better');
    setWeightStr(r.weight != null ? String(r.weight) : '');
    setBenchmarkOn(r.benchmark != null);
    setBenchmarkStr(r.benchmark != null ? String(r.benchmark) : '');
    setBenchmarkNote(r.benchmarkNote ?? '');
    Alert.alert(`Editing ${r.label}`, 'Scroll down to the form to change its name, category, unit, benchmarks or weight.');
  };

  const addCustom = async () => {
    if (!label.trim() || (atCustomLimit && !editingKey) || !weightValid || !benchmarkValid) return;
    const key = editingKey ?? label.trim().toLowerCase().replace(/\s+/g, '_');

    let defaultUnit = unit.trim();
    if (scoringType === 'time' && !defaultUnit) defaultUnit = 'sec';
    else if (scoringType === 'distance' && !defaultUnit) defaultUnit = 'ft';
    else if (scoringType === 'speed' && !defaultUnit) defaultUnit = 'mph';

    const minNum = minValStr.trim() !== '' ? readNumber(minValStr) : undefined;
    const maxNum = maxValStr.trim() !== '' ? readNumber(maxValStr) : undefined;

    const isMetric = isMetricScoringType(scoringType);

    const nextItem = {
      key,
      label: label.trim(),
      category: category.trim() || undefined,
      scoringType,
      scale: scoringType === 'skill' ? scale : ('1-5' as const),
      unit: isMetric ? defaultUnit : undefined,
      minVal: isMetric && minNum != null && !isNaN(minNum) ? minNum : undefined,
      maxVal: isMetric && maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
      rankingDirection,
      weight: weightNum != null && !isNaN(weightNum) ? weightNum : undefined,
      benchmark: benchmarkActive ? benchmarkNum : undefined,
      benchmarkNote: benchmarkActive ? benchmarkNote.trim() || undefined : undefined,
    };

    const next = editingKey ? custom.map((r) => (r.key === editingKey ? { ...r, ...nextItem } : r)) : [...custom, nextItem];

    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        settings: {
          ...tryout.settings,
          customRubrics: next,
        },
      },
    });

    // Category is deliberately not cleared — a coach usually adds several
    // drills to the same category back to back (e.g. five Skating drills),
    // so keeping it selected saves re-picking it each time.
    resetForm();
  };

  // The order here is the order the drills are scored in, so coaches can fix a
  // list they entered out of sequence.
  const moveCustom = async (from: number, to: number) => {
    if (to < 0 || to >= custom.length) return;
    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: { settings: { ...tryout.settings, customRubrics: moveItem(custom, from, to) } },
      });
    } catch (err: any) {
      showAlert('Error', err.message || 'Failed to change the order.');
    }
  };

  const removeCustom = async (keyToRemove: string) => {
    const next = custom.filter((r) => r.key !== keyToRemove);
    const nextSkaterWeights = { ...tryout.settings.skaterWeights };
    const nextGoalieWeights = { ...tryout.settings.goalieWeights };
    delete nextSkaterWeights[keyToRemove];
    delete nextGoalieWeights[keyToRemove];

    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          settings: {
            ...tryout.settings,
            customRubrics: next,
            skaterWeights: nextSkaterWeights,
            goalieWeights: nextGoalieWeights,
          },
        },
      });
      showAlert('Success', 'Custom rubric removed successfully.');
    } catch (err: any) {
      showAlert('Error', err.message || 'Failed to remove custom rubric.');
    }
  };

  // What each rubric actually contributes: its own weight, or an even share of
  // whatever the weighted rubrics leave over.
  // Shown as each rubric's share of the total, so the percentages always add up
  // to 100% (with weights over 100%, or none left over for the unweighted ones,
  // the raw numbers added up to more, which read as a mistake).
  const rawWeights = resolveWeights(custom.map((r) => r.weight));
  const rawTotal = rawWeights.reduce((sum, w) => sum + w, 0);
  const effectiveWeights = rawTotal > 0 ? rawWeights.map((w) => (w / rawTotal) * 100) : rawWeights;
  const weightedCount = custom.filter((r) => r.weight != null).length;
  const unweightedCount = custom.length - weightedCount;
  const explicitTotal = custom.reduce((sum, r) => sum + (r.weight ?? 0), 0);

  return (
    <Screen scroll insideTabBar>
      <Header title="Evaluation Rubrics" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Custom Rubric Builder
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          All rubrics are fully custom. Define drill categories, metric units, and min/max score benchmarks.
        </Text>
      </Card>

      <UsageNudgeBanner
        tier={tier}
        metric="customRubrics"
        count={custom.length}
        label="custom rubrics"
      />

      <Card className="mb-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Created Rubrics ({custom.length}
            {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
          </Text>
        </View>

        {custom.length > 0 ? (
          <Text className="text-xs" style={{ color: explicitTotal > 100 ? colors.danger : colors.inkMuted }}>
            Weights: {formatPct(explicitTotal)} assigned across {weightedCount}{' '}
            {weightedCount === 1 ? 'rubric' : 'rubrics'}
            {unweightedCount > 0
              ? explicitTotal >= 100
                ? ` · the remaining ${unweightedCount} count equally with the others`
                : ` · the remaining ${unweightedCount} split ${formatPct(Math.max(0, 100 - explicitTotal))} evenly`
              : ''}
            {explicitTotal > 100 ? ' · over 100%, weights are scaled to their share of the total.' : ''}
          </Text>
        ) : null}

        {custom.map((r, i) => {
          const type = r.scoringType ?? 'skill';
          const ruleText = r.rankingDirection === 'lower_is_better' ? 'Shortest wins' : 'Highest wins';
          let details: string;
          if (isBinaryScoringType(type)) {
            const [positive, negative] = binaryLabels(type);
            details = `${positive} / ${negative} · ${positive} scores 5.0`;
          } else if (type === 'observation') {
            details = `1-100 observation (${ruleText})`;
          } else if (type === 'skill') {
            details = `${r.scale ?? '1-5'} scale`;
          } else {
            details = `${r.unit ?? ''} (${ruleText})`;
          }
          if (r.minVal != null && r.maxVal != null) {
            details += ` · Range: ${r.minVal} to ${r.maxVal}`;
          }
          details += ` · Weight: ${formatPct(effectiveWeights[i])}${r.weight == null ? ' (auto)' : ''}`;
          if (r.benchmark != null) {
            details += ` · Benchmark: ${formatBenchmarkValue({ scoringType: r.scoringType, scale: r.scale, unit: r.unit }, r.benchmark)}`;
          }

          return (
            <View key={r.key} className="flex-row items-center justify-between py-2 border-b" style={{ borderColor: colors.border }}>
              <View className="flex-1 mr-2 gap-1">
                <View className="flex-row items-center flex-wrap gap-2">
                  <Text className="font-bold text-base" style={{ color: colors.ink }}>
                    {r.label}
                  </Text>
                  <Badge label={SCORING_TYPE_LABELS[type]} variant="brand" />
                  {r.category ? <Badge label={r.category} /> : null}
                  <Badge label={formatPct(effectiveWeights[i])} />
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {details}
                </Text>
              </View>

              <View className="items-center mr-1">
                <Pressable
                  onPress={() => moveCustom(i, i - 1)}
                  disabled={i === 0 || updateTryout.isPending}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${r.label} up`}
                  className="px-2"
                >
                  <Text style={{ color: i === 0 ? colors.inkFaint : colors.primary, fontSize: 18, fontWeight: 'bold' }}>▲</Text>
                </Pressable>
                <Pressable
                  onPress={() => moveCustom(i, i + 1)}
                  disabled={i === custom.length - 1 || updateTryout.isPending}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${r.label} down`}
                  className="px-2"
                >
                  <Text style={{ color: i === custom.length - 1 ? colors.inkFaint : colors.primary, fontSize: 18, fontWeight: 'bold' }}>▼</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => startEdit(r)} hitSlop={8} className="px-2">
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: 'bold' }}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={() => removeCustom(r.key)}
                hitSlop={8}
                className="px-2"
              >
                <Text style={{ color: colors.danger, fontSize: 22, fontWeight: 'bold' }}>
                  ✕
                </Text>
              </Pressable>
            </View>
          );
        })}

        {custom.length === 0 ? (
          <Text style={{ color: colors.inkMuted }}>
            No custom rubrics added yet. Use the builder below to add drills & categories.
          </Text>
        ) : null}
      </Card>

      <PlanGate feature="customRubrics" title="Custom Rubrics" tierOverride={tier}>
        <Card accent className="gap-3">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            {editingKey ? 'Edit Drill / Category' : 'Add Custom Drill / Category'}
          </Text>

          <Input
            label="1. Drill Name"
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <Input
            label="2. Category (optional)"
            value={category}
            onChangeText={setCategory}
            placeholder="e.g. Skating, groups several drills under one heading"
          />
          {existingCategories.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {existingCategories.map((c) => (
                <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          ) : null}

          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            3. Scoring Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SCORING_TYPES.map((t) => (
              <Chip key={t} label={SCORING_TYPE_LABELS[t]} active={scoringType === t} onPress={() => handleScoringTypeChange(t)} />
            ))}
          </View>

          {isBinaryScoringType(scoringType) ? (
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                4. Answer Buttons
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Badge label={binaryLabels(scoringType)[0]} variant="brand" />
                <Badge label={binaryLabels(scoringType)[1]} />
              </View>
              <Text className="text-xs italic" style={{ color: colors.inkMuted }}>
                Assessors tap {binaryLabels(scoringType)[0]} / {binaryLabels(scoringType)[1]}, or flip the switch.{' '}
                {binaryLabels(scoringType)[0]} scores 5.0, {binaryLabels(scoringType)[1]} scores 1.0.
              </Text>
            </View>
          ) : scoringType === 'observation' ? (
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                4. Ranking Rule
              </Text>
              <Pressable
                onPress={() => setRankingDirection(rankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')}
                className="flex-row items-center justify-between rounded-lg border px-4 py-4 mt-1"
                style={{ borderColor: colors.border, backgroundColor: colors.field }}
              >
                <View className="flex-1 pr-3">
                  <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                    Lowest number is highest ranked: {rankingDirection === 'lower_is_better' ? 'Yes' : 'No'}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                    {rankingDirection === 'lower_is_better'
                      ? 'Scored 1-100 · 1 = best (5.0), 100 = worst (1.0)'
                      : 'Scored 1-100 · 100 = best (5.0), 1 = worst (1.0)'}
                  </Text>
                </View>
                <Switch
                  value={rankingDirection === 'lower_is_better'}
                  onValueChange={(val) => setRankingDirection(val ? 'lower_is_better' : 'higher_is_better')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </Pressable>
            </View>
          ) : scoringType === 'skill' ? (
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                4. Scale Choice
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip label="1-5 Scale" active={scale === '1-5'} onPress={() => setScale('1-5')} />
                <Chip label="1-10 Scale" active={scale === '1-10'} onPress={() => setScale('1-10')} />
              </View>
              <Text className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              <Input
                label="4. Unit Label (Free-form)"
                value={unit}
                onChangeText={setUnit}
                placeholder={
                  scoringType === 'time' ? 'e.g. sec, s, min' : scoringType === 'speed' ? 'e.g. mph, km/h' : 'e.g. ft, m, inches'
                }
              />

              <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: colors.inkMuted }}>
                5. Ranking Rule
              </Text>
              <Pressable
                onPress={() => setRankingDirection(rankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')}
                className="flex-row items-center justify-between rounded-lg border px-4 py-4"
                style={{ borderColor: colors.border, backgroundColor: colors.field }}
              >
                <View className="flex-1 pr-3">
                  <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                    {rankingDirection === 'lower_is_better' ? 'Lowest / Shortest wins' : 'Highest / Farthest wins'}
                  </Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                    {rankingDirection === 'lower_is_better'
                      ? 'Best performance = lowest value (e.g. fastest sprint)'
                      : 'Best performance = highest value (e.g. longest throw)'}
                  </Text>
                </View>
                <Switch
                  value={rankingDirection === 'lower_is_better'}
                  onValueChange={(val) => setRankingDirection(val ? 'lower_is_better' : 'higher_is_better')}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </Pressable>

              <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: colors.inkMuted }}>
                6. Score Range Benchmarks (Min &amp; Max)
              </Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input
                    label="Min Value"
                    value={minValStr}
                    onChangeText={setMinValStr}
                    keyboardType={scoringType === 'time' ? 'default' : 'numeric'}
                    placeholder={rankingDirection === 'lower_is_better' ? '1 (Best)' : '1 (Worst)'}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Max Value"
                    value={maxValStr}
                    onChangeText={setMaxValStr}
                    keyboardType={scoringType === 'time' ? 'default' : 'numeric'}
                    placeholder={rankingDirection === 'lower_is_better' ? '10 (Worst)' : '10 (Best)'}
                  />
                </View>
              </View>

              <Text className="text-xs font-bold italic" style={{ color: colors.primary }}>
                Score Benchmark Rule:{' '}
                {rankingDirection === 'lower_is_better'
                  ? `Min value (${minValStr || '1'}) = 5.0 points (Best)  ·  Max value (${maxValStr || '10'}) = 1.0 points (Worst)`
                  : `Min value (${minValStr || '1'}) = 1.0 points (Worst)  ·  Max value (${maxValStr || '10'}) = 5.0 points (Best)`}
              </Text>
            </View>
          )}

          <View className="gap-1">
            <Input
              label="Weight (% of the overall score)"
              value={weightStr}
              onChangeText={setWeightStr}
              keyboardType="numeric"
              placeholder="e.g. 25, leave blank for an even share"
            />
            {!weightValid ? (
              <Text className="text-xs font-bold" style={{ color: colors.danger }}>
                Weight must be a number between 1 and 100.
              </Text>
            ) : (
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {weightNum != null
                  ? `This rubric carries ${weightNum}% of the overall score.`
                  : 'Left blank, this rubric shares whatever percentage the weighted rubrics leave over.'}
              </Text>
            )}
          </View>

          {canHaveBenchmark(scoringType) ? (
            <View className="gap-2">
              <Pressable onPress={() => setBenchmarkOn(!benchmarkOn)} className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-base" style={{ color: colors.ink }}>
                  Add a benchmark (a target to show next to results)
                </Text>
                <Switch
                  value={benchmarkOn}
                  onValueChange={setBenchmarkOn}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </Pressable>
              {benchmarkOn ? (
                <>
                  <Input
                    label={
                      isMetricScoringType(scoringType)
                        ? `Benchmark${unit.trim() ? ` (${unit.trim()})` : ''}`
                        : scoringType === 'observation'
                          ? 'Benchmark (1-100)'
                          : `Benchmark (out of ${scale === '1-10' ? 10 : 5})`
                    }
                    value={benchmarkStr}
                    onChangeText={setBenchmarkStr}
                    keyboardType={scoringType === 'time' ? 'default' : 'decimal-pad'}
                    placeholder={scoringType === 'time' ? 'e.g. 45 or 1:30' : 'e.g. 30'}
                  />
                  <Input
                    label="What this benchmark means (optional)"
                    value={benchmarkNote}
                    onChangeText={(t) => setBenchmarkNote(t.slice(0, 300))}
                    placeholder="e.g. What a player aiming for the top team usually reaches"
                  />
                  {!benchmarkValid ? (
                    <Text className="text-xs font-bold" style={{ color: colors.danger }}>
                      {benchmarkMax({ scoringType, scale }) != null ? `Enter a number above 0 and up to ${benchmarkMax({ scoringType, scale })}.` : 'Enter a number above 0.'}
                    </Text>
                  ) : (
                    <Text className="text-xs" style={{ color: colors.inkMuted }}>
                      Shown on the scoring screen and on each player's report card, beside their own result.
                    </Text>
                  )}
                </>
              ) : null}
            </View>
          ) : null}

          <Button
            label={editingKey ? 'Save Changes' : 'Add Rubric Category'}
            onPress={addCustom}
            loading={updateTryout.isPending}
            disabled={(atCustomLimit && !editingKey) || !label.trim() || !weightValid || !benchmarkValid}
          />
          {editingKey ? <Button label="Cancel" variant="secondary" onPress={resetForm} /> : null}
        </Card>
      </PlanGate>
    </Screen>
  );
}
