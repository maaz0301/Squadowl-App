import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const BRIGHT = '#F8FAFC';

import { Card } from '@/components/ui';
import { computePlayerResults, useSeasonsQuery, useTryoutQuery } from '@/features/queries';
import { MONTH_NAMES, todayKey } from '@/lib/monthGrid';
import { sportLabel, useTerms } from '@/lib/terms';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { SeasonEvent, TryoutSummary } from '@/data/types';

export type LiveKind = 'today' | 'upcoming' | 'latest';

/** The evaluation to feature: today's, else the next upcoming one, else the most recently touched with players. */
export function pickLiveTryout(tryouts: TryoutSummary[]): { tryout: TryoutSummary; today: boolean; kind: LiveKind } | null {
  const open = tryouts.filter((t) => !t.archived && t.playerCount > 0);
  const today = todayKey();
  const scheduledToday = open.find((t) => t.tryoutDate === today);
  if (scheduledToday) return { tryout: scheduledToday, today: true, kind: 'today' };
  const upcoming = open
    .filter((t) => t.tryoutDate && t.tryoutDate > today)
    .sort((a, b) => (a.tryoutDate! + (a.startTime ?? '')).localeCompare(b.tryoutDate! + (b.startTime ?? '')))[0];
  if (upcoming) return { tryout: upcoming, today: false, kind: 'upcoming' };
  const latest = [...open].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest ? { tryout: latest, today: false, kind: 'latest' } : null;
}

function Icon({ d, color, size = 18 }: { d: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Featured evaluation with how many players are scored and a one-tap way back into scoring. */
export function LiveTryoutCard({
  tryout,
  kind,
  onResume,
}: {
  tryout: TryoutSummary;
  kind: LiveKind;
  onResume: () => void;
}) {
  const colors = useThemeColors();
  const terms = useTerms();
  const { data } = useTryoutQuery(tryout.id);
  const total = data?.roster.length ?? tryout.playerCount;
  const scored = useMemo(
    () => (data ? computePlayerResults(data).filter((r) => r.evalCount > 0).length : 0),
    [data],
  );
  const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const when = [kind === 'upcoming' ? tryout.tryoutDate : undefined, tryout.startTime, tryout.rink].filter(Boolean).join(' · ');

  return (
    <View
      className="p-4 gap-3"
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 24, overflow: 'hidden' }}
    >
      {/* Soft orange glow, top right. */}
      <Svg width={box.w} height={box.h} style={{ position: 'absolute', top: 0, left: 0 }}>
        <Defs>
          <LinearGradient id="liveGlow" x1="1" y1="0" x2="0.3" y2="0.7">
            <Stop offset="0" stopColor="#FF6B2B" stopOpacity={0.32} />
            <Stop offset="1" stopColor="#FF6B2B" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={box.w} height={box.h} fill="url(#liveGlow)" />
      </Svg>
      <View className="flex-row items-center justify-between" >
        <View className="px-2.5 py-1 rounded-md" style={{ backgroundColor: 'rgba(255,107,43,0.14)' }}>
          <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.primary }}>
            {kind === 'today' ? 'LIVE TODAY' : kind === 'upcoming' ? 'UPCOMING EVALUATION' : 'LATEST EVALUATION'}
          </Text>
        </View>
        {when ? (
          <Text className="flex-1 text-right ml-2" numberOfLines={1} style={{ fontSize: 13, color: BRIGHT }}>
            {when}
          </Text>
        ) : null}
      </View>
      <View>
        <Text className="font-display font-bold" numberOfLines={2} style={{ fontSize: 26, color: BRIGHT }}>
          {tryout.name}
        </Text>
        <Text className="mt-0.5" style={{ fontSize: 16, color: BRIGHT }}>
          {sportLabel(tryout.sport, terms)} · {tryout.eventType}
        </Text>
      </View>
      <View>
        <View className="flex-row justify-between mb-1.5">
          <Text style={{ fontSize: 15, color: BRIGHT }}>
            {scored} of {total} {total === 1 ? terms.player.toLowerCase() : terms.players.toLowerCase()} scored
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.primary }}>{pct}%</Text>
        </View>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.border }}>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.primary, width: `${pct}%` }} />
        </View>
      </View>
      <Pressable
        onPress={onResume}
        accessibilityRole="button"
        accessibilityLabel={`Resume scoring ${tryout.name}`}
        className="flex-row items-center justify-center gap-2"
        style={{ backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 16, minHeight: 56 }}
      >
        <Text className="font-bold" style={{ color: '#0B1220', fontSize: 18 }}>
          {scored > 0 ? 'Resume scoring' : 'Start scoring'}
        </Text>
        <Icon d="M5 12h14M13 6l6 6-6 6" color="#0B1220" size={18} />
      </Pressable>
    </View>
  );
}

export interface HubAction {
  key: string;
  label: string;
  /** SVG path data, 24x24 stroke icon. */
  icon: string;
  onPress: () => void;
}

/** Three big shortcut tiles: icon chip over a two-line label. */
export function HubActions({ actions }: { actions: HubAction[] }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row gap-3">
      {actions.map((a) => (
        <Pressable
          key={a.key}
          onPress={a.onPress}
          className="flex-1 p-3 gap-3"
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 18, minHeight: 120 }}
        >
          <View
            className="items-center justify-center rounded-lg"
            style={{ width: 40, height: 40, backgroundColor: 'rgba(255,107,43,0.2)' }}
          >
            <Icon d={a.icon} color={colors.primary} />
          </View>
          <Text className="font-bold" style={{ fontSize: 16, color: BRIGHT }} numberOfLines={2}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

type WeekItem = {
  key: string;
  date: string;
  time?: string;
  title: string;
  sub: string;
  tag: string;
  isEval: boolean;
  open: () => void;
};

/** The next seven days across every team: events and evaluations together, each with a tag. */
export function ThisWeek({
  tryouts,
  onSeeAll,
  onOpenEvent,
  onOpenTryout,
}: {
  tryouts: TryoutSummary[];
  onSeeAll: () => void;
  onOpenEvent: (event: SeasonEvent, teamId?: string) => void;
  onOpenTryout: (id: string) => void;
}) {
  const colors = useThemeColors();
  const seasonsQuery = useSeasonsQuery();
  const items = useMemo(() => {
    const from = todayKey();
    const to = addDays(from, 7);
    const eventItems: WeekItem[] = (seasonsQuery.data ?? []).flatMap((s) =>
      s.events.map((ev) => ({
        key: `e-${ev.id}`,
        date: ev.date,
        time: ev.startTime,
        title: ev.title,
        sub: [ev.startTime, ev.location ?? s.teamName].filter(Boolean).join(' · '),
        tag: String(ev.type).replace(/^./, (c) => c.toUpperCase()),
        isEval: false,
        open: () => onOpenEvent(ev, s.teamId),
      })),
    );
    const evalItems: WeekItem[] = tryouts
      .filter((t) => !t.archived && t.tryoutDate)
      .map((t) => ({
        key: `t-${t.id}`,
        date: t.tryoutDate as string,
        time: t.startTime,
        title: t.name,
        sub: [t.startTime, t.rink].filter(Boolean).join(' · ') || `${t.playerCount} ${t.playerCount === 1 ? 'player' : 'players'}`,
        tag: 'Evaluation',
        isEval: true,
        open: () => onOpenTryout(t.id),
      }));
    return [...eventItems, ...evalItems]
      .filter((i) => i.date >= from && i.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
      .slice(0, 6);
  }, [seasonsQuery.data, tryouts, onOpenEvent, onOpenTryout]);

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text className="font-display font-bold" style={{ fontSize: 22, color: BRIGHT }}>This week</Text>
        <Pressable onPress={onSeeAll} hitSlop={8} accessibilityRole="button">
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.primary }}>See all</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Card>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>Nothing scheduled in the next 7 days.</Text>
        </Card>
      ) : (
        items.map((it) => {
          const d = new Date(`${it.date}T12:00:00`);
          return (
            <Pressable
              key={it.key}
              onPress={it.open}
              className="flex-row items-center gap-4 mb-2 px-4 py-3"
              style={{ backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 18 }}
            >
              <View className="items-center" style={{ width: 36 }}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: colors.primary }}>{WEEKDAY[d.getDay()]}</Text>
                <Text className="font-display font-bold" style={{ fontSize: 24, color: BRIGHT }}>{d.getDate()}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-bold" numberOfLines={1} style={{ fontSize: 17, color: BRIGHT }}>{it.title}</Text>
                <Text numberOfLines={1} style={{ fontSize: 14, color: '#CBD5E1' }}>{it.sub || MONTH_NAMES[d.getMonth()]}</Text>
              </View>
              <View
                className="px-2.5 py-1 rounded-full border"
                style={{
                  backgroundColor: it.isEval ? 'rgba(255,107,43,0.16)' : 'rgba(59,130,246,0.16)',
                  borderColor: it.isEval ? 'rgba(255,107,43,0.4)' : 'rgba(59,130,246,0.4)',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: it.isEval ? colors.primary : '#93C5FD' }}>{it.tag}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}
