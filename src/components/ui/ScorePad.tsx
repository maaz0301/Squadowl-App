import { Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { getScoreHeatLevel } from '@/data/rubrics';
import { themeTokens } from '@/theme/tokens';

interface ScorePadProps {
  rubricKey: string;
  label: string;
  scale: '1-5' | '1-10';
  value?: number;
  onChange: (value: number) => void;
}

export function ScorePad({ label, scale, value, onChange }: ScorePadProps) {
  const colors = useThemeColors();
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
