import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { HUB_ICONS } from './hubTheme';

/** Small icon + uppercase label, with an optional "View All >" link. */
export function HubSectionLabel({
  icon,
  label,
  actionLabel,
  onAction,
}: {
  icon: string;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between mb-3">
      <View className="flex-row items-center gap-2">
        <HubIcon d={icon} size={14} color={colors.primary} />
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} className="flex-row items-center gap-1">
          <Text className="text-xs font-medium" style={{ color: colors.inkMuted }}>
            {actionLabel}
          </Text>
          <HubIcon d={HUB_ICONS.chevron} size={12} color={colors.inkMuted} strokeWidth={2.5} />
        </Pressable>
      ) : null}
    </View>
  );
}
