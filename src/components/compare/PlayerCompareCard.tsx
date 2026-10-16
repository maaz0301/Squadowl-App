import { useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { useThemeColors } from '@/theme/ThemeProvider';
import { getPlayerCategories } from '@/data/rubrics';
import { POSITION_OPTIONS_BY_SPORT } from '@/data/positions';
import type { PlayerResult, Tryout } from '@/data/types';

export const COMPARE_MAX_PLAYERS = 3;
const SERIES_COLORS = ['#FF6B2B', '#3B82F6', '#94A3B8'];
const LIGHT = '#F8FAFC';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const SIZE = 270;
// Wider than tall so side labels have room instead of being clipped at the canvas edge.
const WIDTH = 370;
const CENTER_X = WIDTH / 2;
const CENTER = SIZE / 2;
const RADIUS = 84;
const RINGS = 3;

interface Props {
  tryout: Tryout;
  results: PlayerResult[];
  /** Everyone's results, so each player's percentile is against the whole roster. */
  population: PlayerResult[];
}

function formatScore(v: number | undefined) {
  return v == null ? '-' : v.toFixed(1);
}

function ordinal(n: number) {
  const rem = n % 100;
  if (rem >= 11 && rem <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function PlayerCompareCard({ tryout, results, population }: Props) {
  const colors = useThemeColors();

  const axes = useMemo(() => {
    const labels = new Map<string, string>();
    for (const r of results) {
      for (const c of getPlayerCategories(tryout.sport, r.player.pos, tryout.settings.customRubrics)) {
        if (r.categoryScores[c.key] != null && !labels.has(c.key)) labels.set(c.key, c.label);
      }
    }
    return [...labels.entries()].map(([key, label]) => ({ key, label }));
  }, [results, tryout]);

  if (results.length === 0) return null;

  const positionLabel = (pos?: string) => {
    const code = (pos ?? '').trim();
    const option = POSITION_OPTIONS_BY_SPORT[tryout.sport]?.find((o) => o.code.toUpperCase() === code.toUpperCase());
    return (option?.label ?? code).toUpperCase();
  };
  const scoredPool = population.filter((r) => r.overall > 0);
  const percentile = (r: PlayerResult) =>
    r.overall > 0 && scoredPool.length > 0
      ? Math.round((scoredPool.filter((o) => o.overall <= r.overall).length / scoredPool.length) * 100)
      : null;

  // Rubric scores run to 10, but a metric category (reps, seconds) can exceed it: scale to the data.
  const values = results.flatMap((r) => axes.map((a) => r.categoryScores[a.key] ?? 0));
  const hi = Math.max(10, Math.ceil(Math.max(0, ...values)));
  const lo = Math.max(0, Math.floor(Math.min(...values, hi) - 2));

  const cardStyle = { backgroundColor: colors.tile, borderWidth: 1, borderColor: colors.border, borderRadius: 16 };
  const point = (i: number, value: number, extra = 0) => {
    const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const r = Math.max(0, Math.min(1, (value - lo) / (hi - lo))) * RADIUS + extra;
    return { x: CENTER_X + r * Math.cos(angle), y: CENTER + r * Math.sin(angle) };
  };
  const ringValue = (k: number) => lo + ((hi - lo) * k) / RINGS;
  const ringPoints = (k: number) =>
    axes.map((_, i) => point(i, ringValue(k))).map((p) => `${p.x},${p.y}`).join(' ');
  const mirrored = results.length === 2;

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        {results.map((r, i) => {
          const color = SERIES_COLORS[i];
          const pct = percentile(r);
          return (
            <View
              key={r.player.id}
              className="flex-1 px-3 py-2.5"
              style={{ ...cardStyle, borderRadius: 12, borderTopWidth: 2, borderTopColor: color }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 11, color: LIGHT, letterSpacing: 0.2 }}>
                #{r.player.jersey ?? '-'} · {positionLabel(r.player.pos) || '-'}
              </Text>
              <Text className="font-bold mt-1" style={{ color: colors.ink, fontSize: 14 }}>
                {r.player.first} {r.player.last}
              </Text>
              <View className={mirrored ? 'flex-row items-end justify-between mt-1' : 'mt-1'}>
                <Text className="font-display font-bold" style={{ color, fontSize: 28, lineHeight: 32 }}>
                  {r.overall > 0 ? r.overall.toFixed(1) : '-'}
                </Text>
                {pct != null ? (
                  <Text style={{ fontFamily: MONO, fontSize: 11, color: LIGHT, marginBottom: mirrored ? 4 : 0 }}>
                    {ordinal(pct)} pct
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>

      {axes.length >= 3 ? (
        <View className="items-center py-2" style={cardStyle}>
          <Svg width={WIDTH} height={SIZE}>
            {Array.from({ length: RINGS }, (_, k) => k + 1).map((k) => (
              <Polygon key={k} points={ringPoints(k)} fill="none" stroke={colors.border} strokeWidth={1} />
            ))}
            {axes.map((a, i) => {
              const end = point(i, hi);
              const label = point(i, hi, 12);
              const anchor = label.x < CENTER_X - 6 ? 'end' : label.x > CENTER_X + 6 ? 'start' : 'middle';
              return (
                <G key={a.key}>
                  <Line x1={CENTER_X} y1={CENTER} x2={end.x} y2={end.y} stroke={colors.border} strokeWidth={1} />
                  <SvgText
                    x={label.x}
                    y={label.y + 3}
                    fontSize={10}
                    fontFamily={MONO}
                    letterSpacing={0.2}
                    fill={LIGHT}
                    textAnchor={anchor}
                  >
                    {a.label.length > 14 ? `${a.label.slice(0, 13).toUpperCase()}…` : a.label.toUpperCase()}
                  </SvgText>
                </G>
              );
            })}
            {results.map((r, si) => {
              const pts = axes.map((a, i) => point(i, r.categoryScores[a.key] ?? lo));
              return (
                <G key={r.player.id}>
                  <Polygon
                    points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={SERIES_COLORS[si]}
                    fillOpacity={0.18}
                    stroke={SERIES_COLORS[si]}
                    strokeWidth={1.5}
                  />
                  {pts.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={2} fill={SERIES_COLORS[si]} />
                  ))}
                </G>
              );
            })}
            {Array.from({ length: RINGS }, (_, k) => k + 1).map((k) => {
              const p = point(0, ringValue(k));
              return (
                <SvgText key={`s${k}`} x={p.x + 3} y={p.y + 3} fontSize={9} fontFamily={MONO} fill={LIGHT}>
                  {Math.round(ringValue(k))}
                </SvgText>
              );
            })}
          </Svg>
        </View>
      ) : null}

      {axes.length > 0 ? (
        <View className="px-3" style={cardStyle}>
          {axes.map((a, idx) => {
            const divider = idx < axes.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.border } : null;
            return mirrored ? (
              <View key={a.key} className="flex-row items-center py-2.5" style={divider}>
                <Text style={{ width: 38, fontFamily: MONO, fontWeight: '700', fontSize: 14, color: colors.ink }}>
                  {formatScore(results[0].categoryScores[a.key])}
                </Text>
                <Bar value={results[0].categoryScores[a.key]} color={SERIES_COLORS[0]} max={hi} align="end" />
                <Text
                  style={{ width: 124, textAlign: 'center', fontFamily: MONO, fontSize: 11, letterSpacing: 0.2, color: LIGHT }}
                >
                  {a.label.toUpperCase()}
                </Text>
                <Bar value={results[1].categoryScores[a.key]} color={SERIES_COLORS[1]} max={hi} align="start" />
                <Text style={{ width: 38, textAlign: 'right', fontFamily: MONO, fontWeight: '700', fontSize: 14, color: colors.ink }}>
                  {formatScore(results[1].categoryScores[a.key])}
                </Text>
              </View>
            ) : (
              <View key={a.key} className="py-2.5 gap-1.5" style={divider}>
                <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0.3, color: LIGHT }}>
                  {a.label.toUpperCase()}
                </Text>
                {results.map((r, si) => (
                  <View key={r.player.id} className="flex-row items-center">
                    <Bar value={r.categoryScores[a.key]} color={SERIES_COLORS[si]} max={hi} align="start" />
                    <Text style={{ width: 40, textAlign: 'right', fontFamily: MONO, fontWeight: '700', fontSize: 14, color: colors.ink }}>
                      {formatScore(r.categoryScores[a.key])}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ) : (
        <Text className="italic" style={{ color: colors.inkMuted }}>Selected athletes have no rubric scores yet.</Text>
      )}
    </View>
  );
}

/** A thin bar sized against the scale's top, growing toward the label (`end`) or away from it (`start`). */
function Bar({ value, color, max, align }: { value: number | undefined; color: string; max: number; align: 'start' | 'end' }) {
  const pct = Math.max(0, Math.min(100, ((value ?? 0) / max) * 100));
  return (
    <View className="flex-1 px-2" style={{ alignItems: align === 'end' ? 'flex-end' : 'flex-start' }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color, width: `${pct}%` }} />
    </View>
  );
}
