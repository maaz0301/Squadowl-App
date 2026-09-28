import { Pressable, Text, View, ActivityIndicator } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { useHubSurfaces } from './hubTheme';

/**
 * One of the four buttons under Team Status: an icon chip beside a label, on
 * one line — shaped to match TeamStatusTiles right above it (same height,
 * same solid-color icon circle) instead of stacking the icon over the label.
 * Two per row (w-[48.5%] in a flex-wrap row), not four across: an icon circle
 * plus a label as long as "Add to calendar" doesn't fit four-wide on a phone.
 */
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
      className="flex-row items-center gap-2 rounded-lg px-2.5 w-[48.5%]"
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
      <View
        className="items-center justify-center rounded-full"
        style={{ width: 22, height: 22, backgroundColor: tint }}
      >
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <HubIcon d={icon} size={12} color="#fff" strokeWidth={3} />}
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        className="flex-1 font-bold"
        style={{ fontSize: 12, color: danger ? colors.danger : colors.ink }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
