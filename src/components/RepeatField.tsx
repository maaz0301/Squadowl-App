import { Pressable, Text, View } from 'react-native';

import { Chip, DateField } from '@/components/ui';
import {
  MAX_RECURRING_EVENTS,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  expandRecurrence,
  weekdayOf,
} from '@/lib/recurrence';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * "Repeat" for a new event: weekly on chosen days until a date. Lets a coach
 * build a whole calendar (every Tuesday and Thursday practice until the season
 * ends) in one save. Everyone invited is told once about the lot, not once per
 * event.
 */
export function RepeatField({
  date,
  weekdays,
  until,
  onChange,
  error,
}: {
  date?: string;
  weekdays?: number[];
  until?: string;
  onChange: (next: { weekdays: number[]; until: string }) => void;
  error?: string;
}) {
  const colors = useThemeColors();
  const days = weekdays ?? [];
  const repeating = days.length > 0;
  const count = date ? expandRecurrence(date, days, until).length : 0;

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    // Unticking the last day would silently turn this back into a single
    // event, so keep at least one: "Does not repeat" is the way to opt out.
    if (next.length === 0) return;
    onChange({ weekdays: next, until: until ?? '' });
  };

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Repeat
      </Text>
      <View className="flex-row">
        <Chip label="Does not repeat" active={!repeating} onPress={() => onChange({ weekdays: [], until: '' })} />
        <Chip
          label="Weekly"
          active={repeating}
          onPress={() => {
            if (repeating) return;
            const dow = date ? weekdayOf(date) : null;
            onChange({ weekdays: [dow ?? 1], until: '' });
          }}
        />
      </View>

      {repeating ? (
        <View className="gap-2">
          <View className="flex-row gap-2">
            {WEEKDAY_LABELS.map((label, d) => {
              const active = days.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  accessibilityLabel={WEEKDAY_NAMES[d]}
                  accessibilityState={{ selected: active }}
                  className="h-9 w-9 items-center justify-center rounded-full border"
                  style={{
                    backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text className="text-xs font-bold" style={{ color: active ? colors.primary : colors.inkMuted }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <DateField
            label="Repeat until"
            value={until}
            onChange={(v) => onChange({ weekdays: days, until: v })}
            placeholder="Select the last date"
            error={error}
            disablePast
            minDate={date || undefined}
          />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            {!until
              ? 'Pick the last date to repeat until.'
              : count > 1
                ? `Creates ${count} events. Everyone invited gets one email for all of them.${count >= MAX_RECURRING_EVENTS ? ` Capped at ${MAX_RECURRING_EVENTS}.` : ''}`
                : 'No other dates fall on the days you picked. Only the first event will be created.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
