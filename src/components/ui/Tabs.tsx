import { cn } from '@/lib/cn';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeKey, onChange, className }: TabsProps) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={cn('flex-grow-0', className)}
      contentContainerStyle={{ gap: 6, paddingVertical: 4 }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className="px-4 py-2 rounded-full flex-row items-center gap-2 min-h-[40px]"
            style={{
              backgroundColor: active ? colors.primary : colors.tile,
            }}
          >
            <Text
              className="text-sm font-bold"
              style={{ color: active ? '#fff' : colors.inkMuted }}
            >
              {tab.label}
            </Text>
            {tab.badge != null && tab.badge > 0 ? (
              <View
                className="px-1.5 py-0.5 rounded-full min-w-[20px] items-center"
                style={{ backgroundColor: active ? 'rgba(255,255,255,0.25)' : colors.primary }}
              >
                <Text className="text-xs font-bold text-white">{tab.badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
