import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { playerInitials } from '@/data/rubrics';

interface AvatarProps {
  first: string;
  last: string;
  size?: number;
  pos?: string;
}

const posColors: Record<string, string> = {
  FWD: '#ff6b2b',
  DEF: '#6366f1',
  GTL: '#f59e0b',
};

export function Avatar({ first, last, size = 44, pos }: AvatarProps) {
  const colors = useThemeColors();
  const accent = pos ? (posColors[pos.toUpperCase()] ?? colors.primary) : colors.primary;
  return (
    <View
      className="rounded-full items-center justify-center border-2"
      style={{
        width: size,
        height: size,
        backgroundColor: colors.tile,
        borderColor: accent,
      }}
    >
      <Text className="font-display font-bold" style={{ color: colors.ink, fontSize: size * 0.35 }}>
        {playerInitials({ first, last })}
      </Text>
    </View>
  );
}
