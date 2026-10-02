import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Card } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';

export interface QuickAccessItem {
  key: string;
  label: string;
  caption: string;
  /** SVG path data, 24x24 stroke icon. */
  icon: string;
  onPress: () => void;
  /** The section this card jumps to is the one currently showing. */
  active?: boolean;
}

/**
 * Two-column grid of hub shortcuts. Every card shares one treatment — orange is
 * the only accent (icon glyph on a tinted chip, active outline) and the cards
 * differ by icon and label, not by colour.
 */
export function QuickAccessGrid({ items }: { items: QuickAccessItem[] }) {
  const colors = useThemeColors();

  const rows: QuickAccessItem[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));

  return (
    <View className="gap-3">
      {rows.map((row, r) => (
        <View key={r} className="flex-row gap-3">
          {row.map((item) => (
            <Pressable
              key={item.key}
              onPress={item.onPress}
              className="flex-1"
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Card
                className="gap-2"
                style={[
                  // Fill the row so cards beside each other match in height.
                  { flex: 1 },
                  item.active ? { borderColor: colors.primary, backgroundColor: 'rgba(255,107,43,0.09)' } : null,
                ]}
              >
                <View className="flex-row items-center gap-2">
                  <View
                    className="items-center justify-center rounded-md"
                    style={{ width: 30, height: 30, backgroundColor: 'rgba(255,107,43,0.12)' }}
                  >
                    <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
                      <Path
                        d={item.icon}
                        stroke={colors.primary}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                  <Text
                    className="flex-1 font-bold"
                    style={{ fontSize: 14, color: colors.ink }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {item.label}
                  </Text>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M6 9l6 6 6-6" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
                <Text className="text-sm" style={{ color: colors.inkMuted }} numberOfLines={3}>
                  {item.caption}
                </Text>
              </Card>
            </Pressable>
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}
