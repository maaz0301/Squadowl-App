import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';

interface SectionHeaderProps {
  label: string;
  /** Right-hand slot, e.g. a "+ New" button. Ignored when `onToggle` is set. */
  right?: React.ReactNode;
  /** Makes the header a collapse toggle with a chevron. */
  onToggle?: () => void;
  expanded?: boolean;
  /** "View All >" style link on the right. Ignored when `onToggle` or `right` is set. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * One header for every home section, so Quick Access, My Athletes and
 * Evaluations & Tryouts read as parts of the same system. The short orange bar
 * is the only brand accent it carries.
 */
export function SectionHeader({ label, right, onToggle, expanded, actionLabel, onAction }: SectionHeaderProps) {
  const colors = useThemeColors();

  const title = (
    <View className="flex-row items-center gap-2">
      <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: colors.primary }} />
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        {label}
      </Text>
    </View>
  );

  if (onToggle) {
    return (
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        className="flex-row items-center justify-between mb-3"
        accessibilityRole="button"
        accessibilityState={{ expanded: !!expanded }}
      >
        {title}
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path
            d={expanded ? 'M6 9l6 6 6-6' : 'M9 5l7 7-7 7'}
            stroke={colors.inkMuted}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
    );
  }

  return (
    <View className="flex-row items-center justify-between mb-3">
      {title}
      {right ??
        (actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8} className="flex-row items-center gap-1">
            <Text className="text-xs font-bold" style={{ color: colors.primary }}>
              {actionLabel}
            </Text>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Path d="M9 5l7 7-7 7" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
        ) : null)}
    </View>
  );
}
