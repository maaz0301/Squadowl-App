import { useState, useEffect } from 'react';
import { Pressable, Text, View, TextInput } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { OBSERVATION_MAX, binaryLabels, getScoreHeatLevel, isBinaryScoringType, normalizeScore } from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';
import type { RankingDirection, ScoringType } from '@/data/types';

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
  onFocus?: () => void;
}

export function ScorePad({
  label,
  scale = '1-5',
  scoringType = 'skill',
  unit,
  minVal,
  maxVal,
  value,
  rankingDirection,
  onChange,
  onFocus,
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
        <View className="flex-row items-center gap-2">
          <TextInput
            value={textVal}
            onChangeText={(txt) => {
              setTextVal(txt);
              const p = parseFloat(txt);
              if (!isNaN(p)) {
                onChange(p);
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
        {minVal != null && maxVal != null ? (
          <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
            Benchmarked Range: Min = {minVal} {unitText} · Max = {maxVal} {unitText}
          </Text>
        ) : null}
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
