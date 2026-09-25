import { Pressable, Text, ActivityIndicator } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { useHubSurfaces } from './hubTheme';

/** One of the four equal buttons under Team Status: icon beside a short label. */
export function HubActionTile({
  icon,
  label,
  onPress,
  danger,
  loading,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const tint = danger ? colors.danger : s.blueInk;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className="flex-1 items-center justify-center gap-1 rounded-lg px-1"
      style={{
        height: 52,
        backgroundColor: danger ? 'rgba(248,113,113,0.10)' : s.blueBg,
        borderWidth: 1,
        borderColor: danger ? 'rgba(248,113,113,0.5)' : s.blueBorder,
        opacity: loading ? 0.6 : 1,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? <ActivityIndicator size="small" color={tint} /> : <HubIcon d={icon} size={15} color={tint} />}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="font-bold" style={{ fontSize: 10, color: danger ? colors.danger : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
