import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink } from '@/components/MapLink';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { SeasonEvent } from '@/data/types';
import { MONTH_NAMES, WEEKDAYS, addMonths, buildMonthGrid, eventsByDay, todayKey } from '@/lib/monthGrid';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A month grid of a team's events: dots on days that have one, tap a day to
 * list just that day's events. Shared by the team hub's Calendar tab and the
 * season screen, so both look and behave the same.
 */
export function MonthCalendar({
  events,
  teamName,
  teamNameFor,
  onAddEvent,
}: {
  events: SeasonEvent[];
  teamName?: string;
  /** For a calendar that mixes several teams: which team an event belongs to. Shown on each event. */
  teamNameFor?: (event: SeasonEvent) => string | undefined;
  /** When given, a selected day offers "Add event on <date>" and hands the date back. */
  onAddEvent?: (date: string) => void;
}) {
  const colors = useThemeColors();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const dayMap = useMemo(() => eventsByDay(events), [events]);
  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const today = todayKey();
  const go = (delta: number) => {
    setCursor((c) => addMonths(c.year, c.month, delta));
    setSelected(null);
  };

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const shown = (
    selected
      ? (dayMap[selected] ?? [])
      : Object.entries(dayMap)
          .filter(([k]) => k.startsWith(monthPrefix))
          .flatMap(([, evs]) => evs)
          .filter((ev, i, all) => all.indexOf(ev) === i)
  )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable onPress={() => go(-1)} hitSlop={10} accessibilityLabel="Previous month" className="px-3 py-1">
          <Text className="text-2xl" style={{ color: colors.primary }}>‹</Text>
        </Pressable>
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </Text>
        <Pressable onPress={() => go(1)} hitSlop={10} accessibilityLabel="Next month" className="px-3 py-1">
          <Text className="text-2xl" style={{ color: colors.primary }}>›</Text>
        </Pressable>
      </View>

      <View className="mb-1 flex-row">
        {WEEKDAYS.map((d) => (
          <Text key={d} className="text-center text-xs font-bold" style={{ width: `${100 / 7}%`, color: colors.inkMuted }}>{d}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((key, di) => {
            if (!key) return <View key={di} style={{ width: `${100 / 7}%`, height: 52 }} />;
            const count = dayMap[key]?.length ?? 0;
            const isSel = selected === key;
            const isToday = key === today;
            return (
              <View key={di} style={{ width: `${100 / 7}%`, height: 52, padding: 1 }}>
              <Pressable
                onPress={() => setSelected(isSel ? null : key)}
                className="flex-1 items-center justify-center rounded-md border"
                style={{
                  backgroundColor: isSel ? colors.primary : colors.tile,
                  borderColor: isToday ? colors.primary : colors.border,
                }}
              >
                <Text className="text-sm font-semibold" style={{ color: isSel ? '#ffffff' : colors.ink }}>
                  {Number(key.slice(8))}
                </Text>
                {count > 0 ? (
                  <View className="mt-0.5 flex-row items-center gap-0.5">
                    {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                      <View
                        key={i}
                        style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isSel ? '#ffffff' : colors.primary }}
                      />
                    ))}
                  </View>
                ) : null}
              </Pressable>
              </View>
            );
          })}
        </View>
      ))}

      <Text className="mb-2 mt-5 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
        {selected ? `Events on ${selected}` : `Events in ${MONTH_NAMES[cursor.month]}`}
      </Text>
      {selected && onAddEvent ? (
        <View className="mb-3">
          <Button label={`+ Add event on ${selected}`} onPress={() => onAddEvent(selected)} />
        </View>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title="No events" message={selected ? 'Nothing scheduled this day.' : 'Nothing scheduled this month.'} />
      ) : (
        shown.map((ev) => (
          <Card key={ev.id} className="mb-2 flex-row items-center gap-3">
            <View className="w-12 items-center">
              <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
                {ev.date.slice(8, 10)}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
              {teamNameFor?.(ev) ? (
                <Text className="text-xs font-semibold" numberOfLines={1} style={{ color: colors.primary }}>{teamNameFor(ev)}</Text>
              ) : null}
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {ev.startTime ?? '-'} ·{' '}
                {ev.location ? <MapLink location={ev.location} label={ev.title} variant="inline" /> : 'TBD'}
              </Text>
            </View>
            <View className="items-end gap-1.5">
              <Badge label={ev.type} />
              <AddToCalendar event={ev} teamName={teamNameFor?.(ev) ?? teamName} size="sm" />
              <MapLink location={ev.location} label={ev.title} size="sm" />
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
