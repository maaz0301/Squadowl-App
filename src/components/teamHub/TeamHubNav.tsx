import { Pressable, Text, View } from 'react-native';

import { useBottomInset } from '@/hooks/useBottomInset';
import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { HUB_ICONS, useHubSurfaces } from './hubTheme';

export interface HubNavItem {
  key: string;
  label: string;
  icon: string;
  onPress: () => void;
}

/**
 * The hub's own bottom bar: Home leaves for the teams list, the rest switch
 * the hub's tab. The active item gets the orange label and underline.
 */
export function TeamHubNav({ items, activeKey }: { items: HubNavItem[]; activeKey: string }) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const bottomInset = useBottomInset();

  return (
    <View
      className="flex-row"
      style={{
        backgroundColor: s.isDark ? 'rgba(9,16,32,0.98)' : colors.card,
        borderTopWidth: 1,
        borderTopColor: s.panelBorder,
        paddingTop: 8,
        paddingBottom: bottomInset,
      }}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        const tint = active ? colors.primary : colors.inkMuted;
        return (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            className="flex-1 items-center"
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
          >
            <HubIcon d={item.icon} size={20} color={tint} strokeWidth={item.key === 'more' ? 3 : 2} />
            <Text className="font-medium mt-1" style={{ fontSize: 10, color: tint }}>
              {item.label}
            </Text>
            <View
              style={{
                height: 2,
                width: 44,
                marginTop: 5,
                borderRadius: 1,
                backgroundColor: active ? colors.primary : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
