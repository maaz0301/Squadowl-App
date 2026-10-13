import { useState, useEffect } from 'react';
import { Pressable, Text, View, TextInput } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { OBSERVATION_MAX, binaryLabels, getScoreHeatLevel, isBinaryScoringType, normalizeScore } from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';
import type { RankingDirection, ScoringType } from '@/data/types';
import { formatBenchmarkValue } from '@/data/benchmarks';
import { formatClock, parseTimeField, partsToValue, valueToParts, type TimeField, type TimeParts } from '@/lib/timeEntry';

const TIME_FIELDS: { key: TimeField; label: string }[] = [
  { key: 'h', label: 'Hr' },
  { key: 'm', label: 'Min' },
  { key: 's', label: 'Sec' },
  { key: 't', label: '1/10' },
];

/**
 * A timed result typed as hours, minutes, seconds and tenths. The coach turns
 * on the fields the event needs; the entry is stored in the rubric's own unit.
 */
function TimeFields({
  value,
  unit,
  onValue,
  onClear,
  onFocus,
}: {
  value?: number;
  unit?: string;
  onValue: (v: number) => void;
  onClear?: () => void;
  onFocus?: () => void;
}) {
  const colors = useThemeColors();
  const [shown, setShown] = useState<Record<TimeField, boolean>>({ h: valueToParts(value, unit).h > 0, m: true, s: true, t: true });
  const [parts, setParts] = useState<TimeParts>(() => valueToParts(value, unit));
  const [texts, setTexts] = useState<Partial<Record<TimeField, string>>>({});

  // Follow a value changed from outside (another score loaded), but not the
  // one these fields just produced, so a half-typed "05" is left alone.
  useEffect(() => {
    if (value == null) {
      setParts({ h: 0, m: 0, s: 0, t: 0 });
      setTexts({});
    } else if (partsToValue(parts, unit) !== value) {
      setParts(valueToParts(value, unit));
      setTexts({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit]);

  const commit = (next: TimeParts) => {
    setParts(next);
    const v = partsToValue(next, unit);
    if (v > 0) onValue(v);
    else onClear?.();
  };

  // A field switched off counts as zero, so hiding hours cannot leave a stray hour in the total.
  const toggle = (key: TimeField) => {
    const on = !shown[key];
    setShown((prev) => ({ ...prev, [key]: on }));
    if (!on && parts[key] !== 0) {
      setTexts((prev) => ({ ...prev, [key]: '' }));
      commit({ ...parts, [key]: 0 });
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        {TIME_FIELDS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => toggle(f.key)}
            accessibilityRole="switch"
            accessibilityState={{ checked: shown[f.key] }}
            accessibilityLabel={`Use ${f.label}`}
            className="h-8 px-3 rounded-full border items-center justify-center"
            style={{ backgroundColor: shown[f.key] ? colors.primary : colors.field, borderColor: shown[f.key] ? colors.primary : colors.border }}
          >
            <Text className="text-xs font-bold" style={{ color: shown[f.key] ? '#fff' : colors.inkMuted }}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        <Text className="ml-auto text-sm font-extrabold" style={{ color: colors.primary }}>
          {formatClock(partsToValue(parts, unit), unit)}
        </Text>
      </View>
      <View className="flex-row items-end gap-2">
        {TIME_FIELDS.filter((f) => shown[f.key]).map((f) => (
          <View key={f.key} className="flex-1">
            <Text className="text-[10px] font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
              {f.label}
            </Text>
            <TextInput
              value={texts[f.key] ?? (parts[f.key] ? String(parts[f.key]) : '')}
              onChangeText={(txt) => {
                setTexts((prev) => ({ ...prev, [f.key]: txt.replace(/\D/g, '') }));
                commit({ ...parts, [f.key]: parseTimeField(txt, f.key) });
              }}
              onFocus={onFocus}
              keyboardType="number-pad"
              maxLength={f.key === 't' ? 1 : 2}
              placeholder="0"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel={f.label}
              className="h-12 rounded border text-base font-bold text-center"
              style={{ backgroundColor: colors.field, borderColor: colors.border, color: colors.ink }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

interface ScorePadProps {
  rubricKey?: string;
  label: string;
  scale?: '1-5' | '1-10';
  scoringType?: ScoringType;
  unit?: string;
  minVal?: number;
  maxVal?: number;
  value?: number;
  rankingDirection?: RankingDirection;
  onChange: (value: number) => void;
  /** Called when a measured entry is emptied, so a wrong figure can be taken back out. */
  onClear?: () => void;
  /** Marks the test as not attempted: no result, and reports print N/A for it. */
  onNotAttempted?: () => void;
  /** The test is marked as not attempted. */
  notAttempted?: boolean;
  onFocus?: () => void;
  /** The coach's target for this rubric, shown under the entry with its explanation. */
  benchmark?: number;
  benchmarkNote?: string;
}

function BenchmarkHint({
  benchmark,
  note,
  scale,
  scoringType,
  unit,
}: {
  benchmark?: number;
  note?: string;
  scale?: '1-5' | '1-10';
  scoringType?: ScoringType;
  unit?: string;
}) {
  const colors = useThemeColors();
  if (benchmark == null) return null;
  return (
    <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
      <Text style={{ fontWeight: '700', color: colors.ink }}>
        Benchmark: {formatBenchmarkValue({ scoringType, scale, unit }, benchmark)}
      </Text>
      {note ? ` · ${note}` : ''}
    </Text>
  );
}

function ScorePadBase({
  label,
  scale = '1-5',
  scoringType = 'skill',
  unit,
  minVal,
  maxVal,
  value,
  rankingDirection,
  onChange,
  onClear,
  onFocus,
  benchmark,
  benchmarkNote,
}: ScorePadProps) {
  const colors = useThemeColors();
  const [textVal, setTextVal] = useState(value != null ? String(value) : '');

  useEffect(() => {
    setTextVal(value != null ? String(value) : '');
  }, [value]);

  // Yes / No and Effective / Not Effective: a pair of buttons plus a slide
  // switch, either of which sets the same 1 (positive) / 0 (negative) score.
  if (isBinaryScoringType(scoringType)) {
    const [positive, negative] = binaryLabels(scoringType);
    const answered = value != null;
    const isPositive = answered && value > 0;

    return (
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </Text>
          {answered ? (
            <Text className="text-xs font-extrabold px-2 py-0.5 rounded" style={{ backgroundColor: colors.primary + '20', color: colors.primary }}>
              Score: {isPositive ? '5.0' : '1.0'} / 5.0
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center flex-wrap gap-2">
          <BinaryButton label={positive} selected={answered && isPositive} tone="positive" onPress={() => onChange(1)} />
          <BinaryButton label={negative} selected={answered && !isPositive} tone="negative" onPress={() => onChange(0)} />
          <Pressable
            onPress={() => onChange(isPositive ? 0 : 1)}
            className="flex-row items-center gap-2 ml-auto min-h-[48px] px-1"
            accessibilityRole="switch"
            accessibilityState={{ checked: isPositive }}
          >
            <View
              className="w-11 h-6 rounded-full border justify-center"
              style={{
                backgroundColor: isPositive ? colors.primary : colors.tile,
                borderColor: isPositive ? colors.primary : colors.border,
              }}
            >
              <View
                className="w-[18px] h-[18px] rounded-full bg-white"
                style={{ marginLeft: isPositive ? 22 : 2 }}
              />
            </View>
            <Text className="text-xs font-bold" style={{ color: colors.inkMuted }}>
              {answered ? (isPositive ? positive : negative) : 'Not scored'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Observation: a free 1–100 mark, typed or nudged with +/- steppers, with
  // the rubric's own ranking rule deciding whether 1 or 100 is the best mark.
  if (scoringType === 'observation') {
    const isLower = rankingDirection === 'lower_is_better';
    const parsed = parseFloat(textVal);
    const current = !isNaN(parsed) ? Math.max(1, Math.min(OBSERVATION_MAX, parsed)) : null;
    const calculatedScore =
      current !== null ? normalizeScore(current, scale, 'observation', undefined, undefined, rankingDirection) : null;

    const commit = (raw: string) => {
      setTextVal(raw);
      const p = parseFloat(raw);
      if (!isNaN(p)) onChange(Math.max(1, Math.min(OBSERVATION_MAX, Math.round(p))));
    };

    const nudge = (delta: number) => {
      const base = current ?? 1;
      commit(String(Math.max(1, Math.min(OBSERVATION_MAX, Math.round(base + delta)))));
    };

    return (
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-1.5">
          <Text className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </Text>
          <View className="flex-row items-center gap-2">
            {calculatedScore !== null ? (
              <Text className="text-xs font-extrabold px-2 py-0.5 rounded" style={{ backgroundColor: colors.primary + '20', color: colors.primary }}>
                Score: {calculatedScore.toFixed(1)} / 5.0
              </Text>
            ) : null}
            <Text className="text-xs italic font-medium" style={{ color: colors.inkFaint }}>
              ({isLower ? 'Lowest = highest rank' : 'Highest = highest rank'})
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => nudge(-1)}
            className="w-12 h-12 rounded border items-center justify-center"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <Text className="text-lg font-extrabold" style={{ color: colors.ink }}>−</Text>
          </Pressable>
          <TextInput
            value={textVal}
            onChangeText={commit}
            onFocus={onFocus}
            keyboardType="number-pad"
            placeholder="1-100"
            placeholderTextColor={colors.inkFaint}
            className="flex-1 h-12 px-3 rounded border text-base font-bold text-center"
            style={{ backgroundColor: colors.field, borderColor: colors.border, color: colors.ink }}
          />
          <Pressable
            onPress={() => nudge(1)}
            className="w-12 h-12 rounded border items-center justify-center"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <Text className="text-lg font-extrabold" style={{ color: colors.ink }}>+</Text>
          </Pressable>
        </View>
        <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
          Observation range: 1 to {OBSERVATION_MAX} · {isLower ? '1 = best' : `${OBSERVATION_MAX} = best`}
        </Text>
        <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
      </View>
    );
  }

  if (scoringType && scoringType !== 'skill') {
    const unitText = unit ? unit : '';
    const isLower = rankingDirection === 'lower_is_better' || (scoringType === 'time' && !rankingDirection);
    const ruleText = isLower ? 'Shortest / lowest number = highest score' : 'Largest / highest number = highest score';

    const parsed = parseFloat(textVal);
    const calculatedScore = !isNaN(parsed) && minVal != null && maxVal != null
      ? normalizeScore(parsed, scale, scoringType, minVal, maxVal, rankingDirection)
      : null;

    const atBestBenchmark =
      !isNaN(parsed) && minVal != null && maxVal != null && maxVal !== minVal && (isLower ? parsed <= minVal : parsed >= maxVal);

    return (
      <View className="mb-4">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            {label}
          </Text>
          <View className="flex-row items-center gap-2">
            {calculatedScore !== null ? (
              <Text className="text-xs font-extrabold px-2 py-0.5 rounded" style={{ backgroundColor: colors.primary + '20', color: colors.primary }}>
                Score: {calculatedScore.toFixed(1)} / 5.0
              </Text>
            ) : null}
            <Text className="text-xs italic font-medium" style={{ color: colors.inkFaint }}>
              ({ruleText})
            </Text>
          </View>
        </View>
        {scoringType === 'time' ? (
          <TimeFields
            value={value}
            unit={unit}
            onValue={(v) => {
              setTextVal(String(v));
              onChange(v);
            }}
            onClear={() => {
              setTextVal('');
              onClear?.();
            }}
            onFocus={onFocus}
          />
        ) : (
          <View className="flex-row items-center gap-2">
            <TextInput
              value={textVal}
              onChangeText={(txt) => {
                setTextVal(txt);
                const p = parseFloat(txt);
                if (!isNaN(p)) {
                  onChange(p);
                } else if (txt.trim() === '') {
                  onClear?.();
                }
              }}
              onFocus={onFocus}
              keyboardType="decimal-pad"
              placeholder={`Enter numeric ${scoringType}...`}
              placeholderTextColor={colors.inkFaint}
              className="flex-1 h-12 px-3 rounded border text-base font-bold"
              style={{
                backgroundColor: colors.field,
                borderColor: colors.border,
                color: colors.ink,
              }}
            />
            <View
              className="h-12 px-4 rounded justify-center items-center"
              style={{ backgroundColor: colors.tile, borderColor: colors.border, borderWidth: 1 }}
            >
              <Text className="font-bold text-sm" style={{ color: colors.primary }}>
                {unitText}
              </Text>
            </View>
          </View>
        )}
        {minVal != null && maxVal != null ? (
          <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
            Benchmarked Range: Min = {minVal} {unitText} · Max = {maxVal} {unitText}
          </Text>
        ) : null}
        {atBestBenchmark ? (
          <Text className="text-xs mt-1 font-semibold" style={{ color: colors.primary }}>
            This is at or past the {isLower ? 'Min' : 'Max'} benchmark, so it scores the full 5.0. Raise the benchmark in
            Rubrics if players are reaching it easily.
          </Text>
        ) : null}
        <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
      </View>
    );
  }

  const max = scale === '1-10' ? 10 : 5;
  const options = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <View className="mb-4">
      <Text className="text-sm font-bold mb-2" style={{ color: colors.inkMuted }}>
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((n) => {
          const selected = value === n;
          const heat = getScoreHeatLevel(n, max);
          const heatColor = themeTokens.scoreColors[heat];
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              className="min-w-[48px] min-h-[48px] rounded-sm items-center justify-center border"
              style={{
                backgroundColor: selected ? colors.primary : colors.field,
                borderColor: selected ? colors.primary : colors.border,
              }}
            >
              <Text
                className="text-base font-extrabold"
                style={{ color: selected ? '#fff' : heatColor }}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <BenchmarkHint benchmark={benchmark} note={benchmarkNote} scale={scale} scoringType={scoringType} unit={unit} />
    </View>
  );
}

interface ScoreButtonProps {
  value: number;
  selected?: boolean;
  max?: number;
  onPress: () => void;
}

export function ScoreButton({ value, selected, max = 5, onPress }: ScoreButtonProps) {
  const colors = useThemeColors();
  const heat = getScoreHeatLevel(value, max);
  const heatColor = themeTokens.scoreColors[heat];
  return (
    <Pressable
      onPress={onPress}
      className="min-w-[48px] min-h-[48px] rounded-sm items-center justify-center border"
      style={{
        backgroundColor: selected ? colors.primary : colors.field,
        borderColor: selected ? colors.primary : colors.border,
      }}
    >
      <Text className="text-base font-extrabold" style={{ color: selected ? '#fff' : heatColor }}>
        {value}
      </Text>
    </Pressable>
  );
}

interface BinaryButtonProps {
  label: string;
  selected?: boolean;
  tone: 'positive' | 'negative';
  onPress: () => void;
}

function BinaryButton({ label, selected, tone, onPress }: BinaryButtonProps) {
  const colors = useThemeColors();
  const toneColor = tone === 'positive' ? themeTokens.scoreColors.great : themeTokens.scoreColors.poor;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      className="min-h-[48px] items-center justify-center rounded-xl border px-4"
      style={{
        backgroundColor: selected ? toneColor : colors.field,
        borderColor: selected ? toneColor : colors.border,
      }}
    >
      <Text className="text-sm font-extrabold uppercase tracking-wide" style={{ color: selected ? '#fff' : toneColor }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One test's entry, with a line under it saying plainly whether it counts. A test the
 * skater did not take is left empty, and an empty test is left out of the overall
 * score (typing 0 would count as a real, worst result), so "Did not attempt" clears it.
 */
export function ScorePad(props: ScorePadProps) {
  const colors = useThemeColors();
  const { value, onClear, onNotAttempted, notAttempted } = props;
  const markNotAttempted = onNotAttempted ?? onClear;
  if (!markNotAttempted) return <ScorePadBase {...props} />;
  return (
    <View>
      <ScorePadBase {...props} />
      <View className="flex-row items-center justify-between" style={{ marginTop: -10, marginBottom: 16 }}>
        {notAttempted ? (
          <>
            <Text className="flex-1 text-xs font-bold" style={{ color: colors.inkMuted }}>N/A: did not attempt, left out of the overall score</Text>
            {onClear ? (
              <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Undo not attempted for ${props.label}`}>
                <Text className="text-xs font-bold" style={{ color: colors.primary }}>Undo</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text className={value == null ? 'text-xs italic' : 'text-xs'} style={{ color: colors.inkMuted }}>
              {value == null ? 'Not scored: left out of the overall score' : 'Counts toward the overall score'}
            </Text>
            <Pressable onPress={markNotAttempted} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Mark ${props.label} as not attempted`}>
              <Text className="text-xs font-bold" style={{ color: colors.primary }}>Did not attempt</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
