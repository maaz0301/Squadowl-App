import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { HUB_ICONS, useHubSurfaces } from './hubTheme';

/**
 * Full-width tappable row: icon chip, title + caption, chevron. `tone` picks
 * the blue panel (calendar sync) or the orange-outlined one (RSVPs).
 */
export function HubRowCard({
  icon,
  title,
  caption,
  tone = 'blue',
  onPress,
  trailing,
}: {
  icon: string;
  title: string;
  caption: string;
  tone?: 'blue' | 'orange';
  onPress: () => void;
  /** Replaces the chevron, e.g. a spinner or an expand caret. */
  trailing?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const orange = tone === 'orange';
  const accent = orange ? colors.primary : s.blueInk;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg px-3"
      style={{
        minHeight: 56,
        backgroundColor: orange ? s.orangeBg : s.blueBg,
        borderWidth: 1,
        borderColor: orange ? s.orangeBorder : s.blueBorder,
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View
        className="items-center justify-center rounded-lg"
        style={{
          width: 32,
          height: 32,
          backgroundColor: orange ? 'rgba(255,107,43,0.16)' : 'rgba(59,130,246,0.16)',
        }}
      >
        <HubIcon d={icon} size={18} color={accent} />
      </View>
      <View className="flex-1 py-2">
        <Text className="text-sm font-bold" style={{ color: colors.ink }}>
          {title}
        </Text>
        <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
          {caption}
        </Text>
      </View>
      {trailing ?? <HubIcon d={HUB_ICONS.chevron} size={16} color={colors.inkMuted} strokeWidth={2.5} />}
    </Pressable>
  );
}
