import { ActivityIndicator, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { HUB_ICONS } from './hubTheme';

interface Counts {
  yes: number;
  maybe: number;
  no: number;
  pending: number;
}

/**
 * The selected event's RSVP tally as four tiles. Colours here are meaning
 * (going / maybe / not going / waiting), not decoration, so they stay
 * green / amber / red / blue.
 */
export function TeamStatusTiles({ counts, loading }: { counts: Counts; loading?: boolean }) {
  const colors = useThemeColors();

  const tiles = [
    { key: 'yes', value: counts.yes, label: 'Yes', caption: 'Attending', color: '#22c55e', icon: HUB_ICONS.check },
    { key: 'maybe', value: counts.maybe, label: 'Maybe', caption: 'Maybe', color: '#f59e0b', icon: HUB_ICONS.question },
    { key: 'no', value: counts.no, label: 'No', caption: 'Not attending', color: '#ef4444', icon: HUB_ICONS.close },
    { key: 'pending', value: counts.pending, label: 'Pending', caption: 'Pending', color: '#38bdf8', icon: HUB_ICONS.clock },
  ];

  if (loading) {
    return (
      <View className="flex-row items-center gap-2 py-3">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          Loading RSVPs...
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row gap-2">
      {tiles.map((t) => (
        <View
          key={t.key}
          className="flex-1 flex-row items-center gap-1 rounded-lg px-1.5"
          style={{
            height: 50,
            backgroundColor: `${t.color}1f`,
            borderWidth: 1,
            borderColor: `${t.color}66`,
          }}
          accessibilityLabel={`${t.value} ${t.label}`}
        >
          <View
            className="items-center justify-center rounded-full"
            style={{ width: 18, height: 18, backgroundColor: t.color }}
          >
            <HubIcon d={t.icon} size={11} color="#ffffff" strokeWidth={3} />
          </View>
          <View className="flex-1">
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="font-bold" style={{ fontSize: 10, color: colors.ink }}>
              {t.value} {t.label}
            </Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 8, color: colors.inkMuted }}>
              {t.caption}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
