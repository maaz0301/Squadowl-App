import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useThemeColors } from '@/theme/ThemeProvider';

export interface DonutRing {
  label: string;
  pct: number;
  color: string;
}

const SIZE = 132;
const STROKE = 9;

/** Concentric progress rings with a legend, used by the Rankings summary card. */
export function ScoredDonut({ scored, total, rings }: { scored: number; total: number; rings: DonutRing[] }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-4 p-4"
      style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 20 }}
    >
      <Svg width={SIZE} height={SIZE}>
        {rings.map((ring, i) => {
          const r = SIZE / 2 - STROKE / 2 - i * (STROKE + 3);
          const c = 2 * Math.PI * r;
          return (
            <G key={ring.label}>
              <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={colors.border} strokeWidth={STROKE} fill="none" />
              <Circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                stroke={ring.color}
                strokeWidth={STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(Math.min(100, ring.pct) / 100) * c} ${c}`}
                rotation={-90}
                origin={`${SIZE / 2}, ${SIZE / 2}`}
              />
            </G>
          );
        })}
      </Svg>
      <View className="flex-1 gap-1.5">
        <Text style={{ color: colors.ink }}>
          <Text style={{ fontSize: 40, fontWeight: '800' }}>{scored}</Text>
          <Text style={{ fontSize: 20, color: colors.ink }}>/{total}</Text>
        </Text>
        <Text className="mb-1.5" style={{ fontSize: 15, fontWeight: '700', color: colors.primary }}>players scored</Text>
        {rings.map((ring) => (
          <View key={ring.label} className="flex-row items-center gap-2">
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ring.color }} />
            <Text className="flex-1" numberOfLines={1} style={{ fontSize: 14, color: colors.ink }}>{ring.label}</Text>
            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.ink }}>{Math.round(ring.pct)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
