import { Children } from 'react';
import { Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from '@/components/teamHub/HubIcon';
import { useHubSurfaces } from '@/components/teamHub/hubTheme';

/**
 * A home section as one container: header row (icon, label, optional action)
 * with the section's content inside the same bordered panel, rather than a
 * floating label above loose cards. Clips its children so art can bleed to
 * the panel's edge.
 */
export function HomePanel({
  icon,
  label,
  right,
  children,
}: {
  /** 24x24 stroke path for the small header icon. */
  icon: string;
  label: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  return (
    <View
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: s.panelBg,
        borderWidth: 1,
        borderColor: s.panelBorder,
        padding: 12,
      }}
    >
      <View className="flex-row items-center justify-between" style={{ minHeight: 36, marginBottom: Children.toArray(children).length > 0 ? 8 : 0 }}>
        <View className="flex-row items-center gap-2 flex-1 pr-2">
          <HubIcon d={icon} size={16} color={colors.primary} />
          <Text
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: colors.ink }}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** The recessed row card that sits inside a HomePanel. */
export function PanelRow({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  return (
    <View
      className="flex-row items-center gap-3 rounded-lg px-3 py-3"
      style={{
        backgroundColor: s.isDark ? 'rgba(8,14,28,0.55)' : colors.tile,
        borderWidth: 1,
        borderColor: s.panelBorder,
      }}
    >
      {children}
    </View>
  );
}
