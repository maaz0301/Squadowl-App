import { useState, useEffect } from 'react';
import { Pressable, Text, View, TextInput } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { getScoreHeatLevel, normalizeScore } from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';
import type { ScoringType } from '@/data/types';

interface ScorePadProps {
  rubricKey?: string;
  label: string;
  scale?: '1-5' | '1-10';
  scoringType?: ScoringType;
  unit?: string;
  minVal?: number;
  maxVal?: number;
  value?: number;
  rankingDirection?: import('@/data/types').RankingDirection;
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

  if (scoringType && scoringType !== 'skill') {
    const unitText = unit ? unit : '';
    const isLower = rankingDirection === 'lower_is_better' || (scoringType === 'time' && !rankingDirection);
    const ruleText = isLower ? 'Shortest / lowest number = highest score' : 'Largest / highest number = highest score';

    const parsed = parseFloat(textVal);
    const calculatedScore = !isNaN(parsed) && minVal != null && maxVal != null
      ? normalizeScore(parsed, scale, scoringType, minVal, maxVal)
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
