import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';
import { readableInkOn } from '@/lib/teamBrand';

/**
 * Brand colours offered when personalizing a team. A fixed swatch set rather
 * than a free colour wheel: every one of these has been picked to stay legible
 * under the banner's black/white ink rule, and they cover the jersey colours
 * clubs actually use. `null` means "no brand colour" — the banner falls back to
 * the app theme.
 */
export const TEAM_BRAND_COLORS = [
  '#ff6b2b', // brand orange
  '#e11d48', // red
  '#b91c1c', // maroon
  '#ea580c', // burnt orange
  '#f59e0b', // gold
  '#facc15', // yellow
  '#16a34a', // green
  '#047857', // forest
  '#0891b2', // teal
  '#0ea5e9', // sky
  '#2563eb', // royal blue
  '#1e3a8a', // navy
  '#6366f1', // indigo
  '#7c3aed', // purple
  '#db2777', // pink
  '#334155', // slate
] as const;

interface TeamColorPickerProps {
  value?: string | null;
  onChange: (color: string | null) => void;
  label?: string;
  className?: string;
}

/**
 * Sized in explicit style numbers rather than Tailwind width/height classes:
 * inside a wrapping flex row these swatches were collapsing to slivers, since
 * the class-driven width lost to the row's own sizing pass.
 */
const SWATCH = 46;

export function TeamColorPicker({ value, onChange, label = 'Team colour', className }: TeamColorPickerProps) {
  const colors = useThemeColors();

  const swatch = (color: string | null) => {
    const selected = (value ?? null) === color;
    const check = color ? readableInkOn(color) : colors.ink;
    return (
      <Pressable
        key={color ?? 'none'}
        onPress={() => onChange(color)}
        accessibilityRole="button"
        accessibilityLabel={color ? `Team colour ${color}` : 'No team colour'}
        accessibilityState={{ selected }}
        hitSlop={4}
        style={{
          width: SWATCH,
          height: SWATCH,
          borderRadius: SWATCH / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color ?? colors.tile,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? colors.primary : colors.border,
        }}
      >
        {color === null ? (
          <Text className="text-[11px] font-bold" style={{ color: colors.inkMuted }}>
            None
          </Text>
        ) : selected ? (
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20 6L9 17l-5-5"
              stroke={check}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View className={className}>
      <Text className="text-sm font-bold mb-2" style={{ color: colors.ink }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {swatch(null)}
        {TEAM_BRAND_COLORS.map((c) => swatch(c))}
      </View>
    </View>
  );
}
