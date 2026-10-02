import { Pressable, Text, View } from 'react-native';

import { Badge } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { SeasonEvent } from '@/data/types';
import { HubIcon } from './HubIcon';
import { HUB_ICONS, useHubSurfaces } from './hubTheme';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "YYYY-MM-DD" -> the three lines of the date block. Local date, no timezone shift. */
function dateParts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { month: '', day: iso, weekday: '' };
  const date = new Date(y, m - 1, d);
  return { month: MONTHS[m - 1], day: String(d), weekday: WEEKDAYS[date.getDay()] };
}

/**
 * One upcoming event: date block, venue, "title · time", who's invited, type
 * tag. Selecting it opens Team Status, RSVPs, comments and the action row right
 * under it (the orange left edge marks it); the arrow collapses them again.
 */
export function HubEventCard({
  event,
  selected,
  expanded,
  playerCount,
  evaluatorCount,
  onPress,
}: {
  event: SeasonEvent;
  selected: boolean;
  /** The event's details are open under the card; the arrow points down to them, and up once they are showing. */
  expanded: boolean;
  playerCount: number;
  evaluatorCount: number;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const { month, day, weekday } = dateParts(event.date);

  const time = event.startTime ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}` : null;
  const headline = event.location?.trim() || event.title;
  const subline = [event.location?.trim() ? event.title : null, time].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-lg mb-2 pr-3 py-3"
      style={{
        backgroundColor: s.panelBg,
        borderWidth: 1,
        borderColor: selected ? s.orangeBorder : s.panelBorder,
        borderLeftWidth: 3,
        borderLeftColor: selected ? colors.primary : s.panelBorder,
        paddingLeft: 10,
      }}
      accessibilityRole="button"
      accessibilityState={{ selected, expanded }}
    >
      <View
        className="items-center justify-center rounded-lg"
        style={{
          width: 48,
          height: 58,
          backgroundColor: s.isDark ? 'rgba(8,14,28,0.7)' : colors.tile,
          borderWidth: 1,
          borderColor: s.panelBorder,
        }}
      >
        <Text className="font-bold" style={{ fontSize: 10, color: colors.primary }}>
          {month}
        </Text>
        <Text className="text-xl font-display font-bold" style={{ color: colors.ink, lineHeight: 24 }}>
          {day}
        </Text>
        <Text className="font-medium" style={{ fontSize: 9, color: colors.inkMuted }}>
          {weekday}
        </Text>
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <HubIcon d={HUB_ICONS.pin} size={13} color={colors.primary} />
          <Text numberOfLines={1} className="flex-1 text-sm font-bold" style={{ color: colors.ink }}>
            {headline}
          </Text>
        </View>
        {subline ? (
          <Text numberOfLines={1} className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
            {subline}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-3 mt-1.5">
          <View className="flex-row items-center gap-1">
            <HubIcon d={HUB_ICONS.players} size={12} color={colors.inkFaint} />
            <Text style={{ fontSize: 11, color: colors.inkMuted }}>
              {playerCount} players
            </Text>
          </View>
          {evaluatorCount > 0 ? (
            <View className="flex-row items-center gap-1">
              <HubIcon d={HUB_ICONS.user} size={12} color={colors.inkFaint} />
              <Text style={{ fontSize: 11, color: colors.inkMuted }}>
                {evaluatorCount} {evaluatorCount === 1 ? 'evaluator' : 'evaluators'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View className="items-end justify-between self-stretch">
        <Badge label={event.type} variant={event.type === 'Game' ? 'brand' : 'info'} />
        <HubIcon d={expanded ? HUB_ICONS.chevronUp : HUB_ICONS.chevronDown} size={16} color={colors.inkMuted} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}
