import { Image, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { playerInitials } from '@/data/rubrics';

import { normalizePosition } from '@/data/positions';

interface AvatarProps {
  first: string;
  last: string;
  size?: number;
  pos?: string;
  uri?: string;
}

const posColors: Record<string, string> = {
  FWD: '#ff6b2b',
  DEF: '#6366f1',
  GTL: '#f59e0b',
  G: '#f59e0b',
  GK: '#f59e0b',
  LW: '#ff6b2b',
  RW: '#ff6b2b',
  C: '#ff6b2b',
  LD: '#6366f1',
  RD: '#6366f1',
  CB: '#6366f1',
  FB: '#6366f1',
  ST: '#ff6b2b',
  W: '#ff6b2b',
  CM: '#10b981',
  CDM: '#10b981',
  CAM: '#10b981',
};

/**
 * The colour a position is drawn in — the avatar ring here, and the position
 * pill on a roster row. Shared so the two can never drift apart, since it is
 * the pairing that makes a position readable at a glance.
 */
export function positionColor(pos: string | undefined, fallback: string): string {
  if (!pos) return fallback;
  const normalized = normalizePosition(pos);
  return posColors[normalized] ?? posColors[pos.toUpperCase()] ?? fallback;
}

export function Avatar({ first, last, size = 44, pos, uri }: AvatarProps) {
  const colors = useThemeColors();
  const accent = positionColor(pos, colors.primary);
  return (
    <View
      className="rounded-full items-center justify-center border-2 overflow-hidden"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.tile,
        borderColor: accent,
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
          resizeMode="cover"
        />
      ) : (
        <Text className="font-display font-bold" style={{ color: colors.ink, fontSize: size * 0.35 }}>
          {playerInitials({ first, last })}
        </Text>
      )}
    </View>
  );
}
