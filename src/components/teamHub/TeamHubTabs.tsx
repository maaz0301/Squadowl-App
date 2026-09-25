import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { useHubSurfaces } from './hubTheme';

export interface HubTab {
  key: string;
  label: string;
  icon: string;
  badge?: number;
}

/**
 * Equal-width pill row under the hub header. The active pill is the solid
 * orange one; the others are panel-coloured with an orange count dot.
 */
export function TeamHubTabs({
  tabs,
  activeKey,
  onChange,
}: {
  tabs: HubTab[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();

  return (
    <View className="flex-row gap-2 mb-6">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const ink = active ? '#ffffff' : colors.inkMuted;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg"
            style={{
              height: 40,
              backgroundColor: active ? colors.primary : s.panelBg,
              borderWidth: 1,
              borderColor: active ? colors.primary : s.panelBorder,
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <HubIcon d={tab.icon} size={15} color={ink} />
            <Text numberOfLines={1} className="text-xs font-bold" style={{ color: ink }}>
              {tab.label}
            </Text>
            {tab.badge != null && tab.badge > 0 ? (
              <View
                className="items-center justify-center rounded-full"
                style={{
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 4,
                  backgroundColor: active ? 'rgba(255,255,255,0.28)' : colors.primary,
                }}
              >
                <Text className="font-bold" style={{ fontSize: 10, color: '#ffffff' }}>
                  {tab.badge > 99 ? '99+' : tab.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
