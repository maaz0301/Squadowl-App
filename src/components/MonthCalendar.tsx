import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink } from '@/components/MapLink';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import type { SeasonEvent } from '@/data/types';
import { MONTH_NAMES, WEEKDAYS, addMonths, buildMonthGrid, eventsByDay, todayKey } from '@/lib/monthGrid';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Month view is parked: the calendar is week-only for now. Flip to bring the Week / Month switch back. */
const SHOW_MONTH_VIEW = false;

/**
 * A month grid of a team's events: dots on days that have one, tap a day to
 * list just that day's events. Shared by the team hub's Calendar tab and the
 * season screen, so both look and behave the same.
 */
export function MonthCalendar({
  events,
  teamName,
  teamNameFor,
  rosterSizeFor,
  onOpenEvent,
  onAddEvent,
}: {
  events: SeasonEvent[];
  teamName?: string;
  /** For a calendar that mixes several teams: which team an event belongs to. Shown on each event. */
  teamNameFor?: (event: SeasonEvent) => string | undefined;
  /** How many players an event's availability poll goes to. Without it, no poll card is shown. */
  rosterSizeFor?: (event: SeasonEvent) => number | undefined;
  /** When given, a selected day offers "Add event on <date>" and hands the date back. */
  /** Opens an event's full details (the team's schedule, for the all-teams calendar). When set, each event offers it. */
  onOpenEvent?: (event: SeasonEvent) => void;
  onAddEvent?: (date: string) => void;
}) {
  const colors = useThemeColors();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  // Any day inside the week the strip shows; moves a week at a time.
  const [weekBase, setWeekBase] = useState(() => todayKey());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const dayMap = useMemo(() => eventsByDay(events), [events]);
  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const today = todayKey();
  const go = (delta: number) => {
    setCursor((c) => addMonths(c.year, c.month, delta));
    setSelected(null);
  };

  const shiftWeek = (delta: number) => {
    const d = new Date(`${weekBase}T12:00:00`);
    d.setDate(d.getDate() + delta * 7);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setWeekBase(key);
    setSelected(null);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  // The week around the selected day (or today), as the quick strip above the month grid.
  const weekDays = useMemo(() => {
    const base = new Date(`${weekBase}T12:00:00`);
    base.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { key, day: d.getDate(), label: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()] };
    });
  }, [weekBase]);

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const weekKeys = weekDays.map((d) => d.key);
  const shown = (
    selected
      ? (dayMap[selected] ?? [])
      : mode === 'week'
        ? weekKeys.flatMap((k) => dayMap[k] ?? [])
        : Object.entries(dayMap)
          .filter(([k]) => k.startsWith(monthPrefix))
          .flatMap(([, evs]) => evs)
          .filter((ev, i, all) => all.indexOf(ev) === i)
  )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  // The next event this week that still has players who haven't replied: how many have.
  const poll = useMemo(() => {
    for (const ev of shown) {
      const roster = rosterSizeFor?.(ev) ?? 0;
      if (ev.date < today || roster === 0 || ev.availabilityPending || ev.availabilityUnavailable) continue;
      const responded = Object.values(ev.availability ?? {}).filter((a) => a !== 'pending').length;
      if (responded < roster) return { event: ev, responded, total: roster };
    }
    return null;
  }, [shown, today, rosterSizeFor]);

  return (
    <View>
      {SHOW_MONTH_VIEW ? (
      <View
        className="mb-4 flex-row p-1"
        style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}
      >
        {(['week', 'month'] as const).map((m) => {
          const on = mode === m;
          return (
            <Pressable
              key={m}
              onPress={() => {
                setMode(m);
              }}
              accessibilityRole="button"
              className="flex-1 items-center py-2"
              style={{ borderRadius: 10, backgroundColor: on ? colors.primary : 'transparent' }}
            >
              <Text className="text-xs font-bold" style={{ color: on ? '#ffffff' : colors.inkMuted }}>
                {m === 'week' ? 'Week' : 'Month'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      ) : null}

      {mode === 'week' ? (
        <View>
          <View className="mb-3 flex-row items-center justify-between">
            <Pressable onPress={() => shiftWeek(-1)} hitSlop={10} accessibilityLabel="Previous week" className="px-3 py-1">
              <Text className="text-2xl" style={{ color: colors.primary }}>‹</Text>
            </Pressable>
            <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
              {MONTH_NAMES[Number(weekKeys[3].slice(5, 7)) - 1]} {weekKeys[3].slice(0, 4)}
            </Text>
            <Pressable onPress={() => shiftWeek(1)} hitSlop={10} accessibilityLabel="Next week" className="px-3 py-1">
              <Text className="text-2xl" style={{ color: colors.primary }}>›</Text>
            </Pressable>
          </View>
      <View className="mb-4 flex-row" style={{ gap: 6 }}>
        {weekDays.map((d) => {
          const isSel = selected ? selected === d.key : d.key === today;
          const isToday = d.key === today;
          return (
            <Pressable
              key={d.key}
              onPress={() => {
                setSelected(selected === d.key ? null : d.key);
                setCursor({ year: Number(d.key.slice(0, 4)), month: Number(d.key.slice(5, 7)) - 1 });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Show ${d.key}`}
              className="flex-1 items-center py-2"
              style={{
                borderRadius: 14,
                borderWidth: 1,
                backgroundColor: isSel ? colors.primary : colors.tile,
                borderColor: isToday && !isSel ? colors.primary : colors.border,
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '700', color: isSel ? '#ffffff' : colors.inkMuted }}>{d.label}</Text>
              <Text className="text-lg font-display font-bold" style={{ color: isSel ? '#ffffff' : colors.ink }}>{d.day}</Text>
              {(dayMap[d.key]?.length ?? 0) > 0 ? (
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isSel ? '#ffffff' : colors.primary }} />
              ) : (
                <View style={{ width: 5, height: 5 }} />
              )}
            </Pressable>
          );
        })}
      </View>

        </View>
      ) : (
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

        </View>
      )}

      {selected && mode === 'month' ? (
        <Text className="mb-2 mt-5 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
          {`Events on ${selected}`}
        </Text>
      ) : (
        <View className="mt-5" />
      )}
      {selected && onAddEvent ? (
        <View className="mb-3">
          <Button label={`+ Add event on ${selected}`} onPress={() => onAddEvent(selected)} />
        </View>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title="No events" message={selected ? 'Nothing scheduled this day.' : mode === 'week' ? 'Nothing scheduled this week.' : 'Nothing scheduled this month.'} />
      ) : (
        shown.map((ev, i) => (
          <View key={ev.id}>
          {mode === 'week' && (i === 0 || shown[i - 1].date !== ev.date) ? (
            <Text
              className="mb-2 mt-3 text-xs font-bold uppercase"
              style={{ color: ev.date === today ? colors.primary : colors.inkMuted, letterSpacing: 0.8 }}
            >
              {ev.date === today ? 'Today' : new Date(`${ev.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}
            </Text>
          ) : null}
          <EventRow ev={ev} teamName={teamName} teamLabel={teamNameFor?.(ev)} onOpenEvent={onOpenEvent} />
          </View>
        ))
      )}
      {mode === 'week' && poll ? (
        <View
          className="mt-2 p-4"
          style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 18 }}
        >
          <View className="flex-row items-center justify-between mb-2">
            <Text className="font-bold" style={{ color: colors.ink }}>Availability poll</Text>
            <Text style={{ color: colors.ink }}>
              <Text className="text-lg font-display font-bold">{poll.responded}</Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>/{poll.total}</Text>
            </Text>
          </View>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.primary, width: `${(poll.responded / poll.total) * 100}%` }} />
          </View>
          <Text className="text-xs mt-2" numberOfLines={1} style={{ color: colors.inkMuted }}>
            {poll.event.title} · {poll.total - poll.responded} still to reply
          </Text>
        </View>
      ) : null}

    </View>
  );
}

/** One event: date and title always visible, with its actions in a dropdown. */
function EventRow({
  ev,
  teamName,
  teamLabel,
  onOpenEvent,
}: {
  ev: SeasonEvent;
  teamName?: string;
  teamLabel?: string;
  onOpenEvent?: (event: SeasonEvent) => void;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  return (
    <Card className="mb-2 gap-3">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${ev.title}, ${open ? 'hide' : 'show'} actions`}
        className="flex-row items-center gap-3"
      >
        <View className="w-12 items-center">
          <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
            {MONTH_NAMES[Number(ev.date.slice(5, 7)) - 1]?.slice(0, 3)}
          </Text>
          <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
            {ev.date.slice(8, 10)}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-lg font-bold" style={{ color: colors.ink }}>{ev.title}</Text>
          {teamLabel ? (
            <Text className="text-sm font-semibold" numberOfLines={2} style={{ color: colors.primary }}>{teamLabel}</Text>
          ) : null}
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {ev.startTime ?? '-'} ·{' '}
            {ev.location ? <MapLink location={ev.location} label={ev.title} variant="inline" /> : 'TBD'}
          </Text>
        </View>
        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Path d="M6 9l6 6 6-6" stroke={colors.primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      {open ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <View style={{ minHeight: 46, justifyContent: 'center' }}>
            <Badge label={ev.type} size="lg" className="py-2.5" />
          </View>
          {onOpenEvent ? (
            <Pressable
              onPress={() => onOpenEvent(ev)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`View event ${ev.title}`}
              className="rounded-lg border px-3 items-center justify-center"
              style={{ borderColor: colors.primary, borderWidth: 1.5, minHeight: 46 }}
            >
              <Text className="text-sm font-bold" style={{ color: colors.primary }}>View event ›</Text>
            </Pressable>
          ) : null}
          <AddToCalendar event={ev} teamName={teamLabel ?? teamName} size="sm" />
          <MapLink location={ev.location} label={ev.title} size="sm" />
        </View>
      ) : null}
    </Card>
  );
}
