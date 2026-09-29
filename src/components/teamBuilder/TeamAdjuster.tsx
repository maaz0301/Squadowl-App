import { useTerms } from '@/lib/terms';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, FlatList, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Button, Modal } from '@/components/ui';
import { playerDisplayName } from '@/data/rubrics';
import type { TeamBuilderTeam } from '@/data/teamBuilder';
import type { Player } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/** The id the unassigned pile answers to, so it can be a drop zone like any team. */
export const UNASSIGNED = 'unassigned';

/** Hold this long before a press turns into a drag rather than a scroll or a tap. */
const LONG_PRESS_MS = 220;

/** Finger travel that cancels a pending long press — that's a scroll, not a drag. */
const SCROLL_SLOP = 8;

/**
 * One accent per team bin, cycled by index. Ten of them, so a full grid never
 * repeats a colour — the colour is what a coach tracks a player by mid-drag,
 * when the row is detached from its heading.
 */
const TEAM_ACCENTS = [
  '#ff6b2b', '#38bdf8', '#22c55e', '#a78bfa', '#f472b6',
  '#facc15', '#2dd4bf', '#fb7185', '#60a5fa', '#c084fc',
] as const;

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Zone {
  id: string;
  name: string;
  accent: string;
  playerIds: string[];
  /** Mean overall of the scored players in the bin, or null when none are scored. */
  avg: string | null;
}

/**
 * Manual adjustment of a generated split: drag a player onto another team, or
 * tap them and pick one.
 *
 * Two ways to do the same move, on purpose. Dragging is what the web app does
 * and what the feature is sold as, but a phone is a bad place to be the only
 * option — a long roster, a small screen, or anyone who can't hold a drag needs
 * the sheet. Both funnel through the same `onMove`, so undo history doesn't
 * care which was used.
 *
 * Rendered as a screen-filling panel rather than inside a <Modal>: modal
 * content mounts in its own native root, outside the app's single
 * GestureHandlerRootView, and touch handling there is a known trap (see
 * TeamColorPicker). This uses PanResponder — RN's own responder system — which
 * works under any root, and claims the gesture only once a long press has armed
 * it, so the player list still scrolls normally and a plain tap still taps.
 */
export function TeamAdjuster({
  teams,
  unassigned,
  playerById,
  overallByPlayerId,
  onMove,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDone,
  labels,
}: {
  /** The evaluation's own names. */
  labels?: import('@/data/types').CustomLabels;
  teams: TeamBuilderTeam[];
  unassigned: string[];
  playerById: Map<string, Player>;
  overallByPlayerId: Map<string, number>;
  /** `from`/`to` are zone ids: a team id, or UNASSIGNED. */
  onMove: (playerId: string, from: string, to: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}) {
  const colors = useThemeColors();
  const terms = useTerms(labels);

  const zones = useMemo<Zone[]>(() => {
    // Same rule as the team cards on the Team Builder screen: an overall of 0 is
    // the absence of a rating, not a low one, so it stays out of the average.
    // Shown here so the effect of a move on both teams is visible as it happens.
    const averageOf = (playerIds: string[]): string | null => {
      const scores = playerIds.map((id) => overallByPlayerId.get(id) ?? 0).filter((v) => v > 0);
      return scores.length > 0 ? (scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(1) : null;
    };
    return [
      ...teams.map((t, i) => ({
        id: t.id,
        name: t.name,
        accent: TEAM_ACCENTS[i % TEAM_ACCENTS.length],
        playerIds: t.players,
        avg: averageOf(t.players),
      })),
      { id: UNASSIGNED, name: 'Unassigned', accent: colors.inkMuted, playerIds: unassigned, avg: null },
    ];
  }, [teams, unassigned, colors.inkMuted, overallByPlayerId]);

  // Android's back gesture would otherwise pop the whole Team Builder screen,
  // taking every manual adjustment with it — including the ones made before the
  // panel was opened. Here it just closes the panel, like Done.
  // Read through a ref so the subscription is set up once: `onDone` is an inline
  // arrow at the call site, and this component re-renders on every frame of a
  // drag — keying the effect on it would resubscribe throughout.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDoneRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const [focusedZoneId, setFocusedZoneId] = useState<string>(zones[0]?.id ?? UNASSIGNED);
  // A team emptied by dragging its last player away shouldn't strand the panel
  // on a zone that no longer exists.
  const focusedZone = zones.find((z) => z.id === focusedZoneId) ?? zones[0];

  const [dragging, setDragging] = useState<{ playerId: string; from: string } | null>(null);
  // True from the moment a hold has been long enough to mean a drag, before the
  // finger has moved. The list has to stop scrolling *then*: once the finger
  // moves, the list's own scroll gesture starts at the same instant the drag
  // asks for the touch, and it can win — the row scrolls away instead of lifting.
  const [holdingRow, setHoldingRow] = useState(false);
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null);
  const [movePickerFor, setMovePickerFor] = useState<{ playerId: string; from: string } | null>(null);

  // Window-space rectangles for each bin, and for the panel itself so the drag
  // ghost (positioned relative to the panel) can be placed from window coords.
  const zoneFrames = useRef<Record<string, Frame>>({});
  const panelRef = useRef<View>(null);
  const panelOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const ghost = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  const registerZone = useCallback((zoneId: string, frame: Frame) => {
    zoneFrames.current[zoneId] = frame;
  }, []);

  const zoneAt = (windowX: number, windowY: number): string | null => {
    for (const [id, f] of Object.entries(zoneFrames.current)) {
      if (windowX >= f.x && windowX <= f.x + f.width && windowY >= f.y && windowY <= f.y + f.height) return id;
    }
    return null;
  };

  const moveGhost = (windowX: number, windowY: number) => {
    ghost.setValue({ x: windowX - panelOrigin.current.x - 110, y: windowY - panelOrigin.current.y - 22 });
  };

  return (
    <View
      ref={panelRef}
      className="flex-1"
      onLayout={() => {
        // measureInWindow rather than the layout event's own x/y: those are
        // relative to the parent, and the ghost is placed from window coords.
        panelRef.current?.measureInWindow((x, y) => {
          panelOrigin.current = { x, y };
        });
      }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
          Adjust Teams
        </Text>
        <View className="flex-row gap-2">
          <Button label="↶" variant="secondary" size="sm" disabled={!canUndo} onPress={onUndo} />
          <Button label="↷" variant="secondary" size="sm" disabled={!canRedo} onPress={onRedo} />
          <Button label="Done" size="sm" onPress={onDone} />
        </View>
      </View>

      <Text className="text-xs mb-2" style={{ color: colors.inkMuted }}>
        {dragging
          ? terms.t('Drop on a team to move this player.')
          : terms.t('Hold a player to drag them onto a team, or tap one to pick a team. Undo and redo take a mis-drop back.')}
      </Text>

      {/* The bins. Their own scroll view so a ten-team split still fits, and
          capped so the player list below always keeps most of the screen. */}
      <ScrollView
        style={{ maxHeight: '38%' }}
        contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap' }}
        showsVerticalScrollIndicator={false}
        // Locked while dragging so the targets can't slide out from under the
        // frames measured when the drag began.
        scrollEnabled={!dragging}
      >
        {zones.map((zone) => (
          <ZoneBin
            key={zone.id}
            zone={zone}
            focused={zone.id === focusedZoneId}
            hovered={hoverZoneId === zone.id && dragging?.from !== zone.id}
            colors={colors}
            onPress={() => setFocusedZoneId(zone.id)}
            onFrame={registerZone}
          />
        ))}
      </ScrollView>

      <View className="flex-row items-center justify-between mt-3 mb-1">
        <Text className="text-sm font-display font-bold" style={{ color: focusedZone?.accent ?? colors.ink }}>
          {focusedZone?.name ?? '-'}
        </Text>
        <Badge label={`${focusedZone?.playerIds.length ?? 0} players`} />
      </View>

      <FlatList
        className="flex-1"
        data={focusedZone?.playerIds ?? []}
        keyExtractor={(pid) => pid}
        // Dropping the responder mid-drag would strand the ghost, and the list
        // must not scroll away underneath a lifted row.
        scrollEnabled={!dragging && !holdingRow}
        ListEmptyComponent={
          <Text className="text-sm py-6 text-center" style={{ color: colors.inkMuted }}>
            No players on this team. Drag someone in, or tap a player on another team.
          </Text>
        }
        renderItem={({ item: playerId }) => (
          <DraggableRow
            playerId={playerId}
            player={playerById.get(playerId)}
            overall={overallByPlayerId.get(playerId)}
            accent={focusedZone?.accent ?? colors.border}
            colors={colors}
            isDragging={dragging?.playerId === playerId}
            onHold={setHoldingRow}
            onTap={() => setMovePickerFor({ playerId, from: focusedZone?.id ?? UNASSIGNED })}
            onDragStart={(windowX, windowY) => {
              setDragging({ playerId, from: focusedZone?.id ?? UNASSIGNED });
              moveGhost(windowX, windowY);
              setHoverZoneId(zoneAt(windowX, windowY));
            }}
            onDragMove={(windowX, windowY) => {
              moveGhost(windowX, windowY);
              const over = zoneAt(windowX, windowY);
              setHoverZoneId((prev) => (prev === over ? prev : over));
            }}
            onDragEnd={(windowX, windowY) => {
              const target = zoneAt(windowX, windowY);
              const from = focusedZone?.id ?? UNASSIGNED;
              if (target && target !== from) onMove(playerId, from, target);
              setDragging(null);
              setHoverZoneId(null);
            }}
          />
        )}
      />

      {/* The lifted row, following the finger. pointerEvents none so it never
          eats the touches driving it. */}
      {dragging ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 220,
            transform: ghost.getTranslateTransform(),
            opacity: 0.95,
          }}
        >
          <View
            className="flex-row items-center gap-2 rounded-xl border px-3 py-2"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.primary,
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <Text className="flex-1 text-sm font-bold" numberOfLines={1} style={{ color: colors.ink }}>
              {(() => {
                const p = playerById.get(dragging.playerId);
                return p ? playerDisplayName(p) : 'Player';
              })()}
            </Text>
          </View>
        </Animated.View>
      ) : null}

      <Modal
        visible={!!movePickerFor}
        title={terms.t('Move Player')}
        onClose={() => setMovePickerFor(null)}
      >
        <View className="gap-2">
          {movePickerFor ? (
            <Text className="text-sm mb-1" style={{ color: colors.inkMuted }}>
              {(() => {
                const p = playerById.get(movePickerFor.playerId);
                return p ? playerDisplayName(p) : 'This player';
              })()}{' '}
              is on {zones.find((z) => z.id === movePickerFor.from)?.name ?? 'a team'}.
            </Text>
          ) : null}
          {zones.map((zone) => {
            const isCurrent = zone.id === movePickerFor?.from;
            return (
              <Pressable
                key={zone.id}
                disabled={isCurrent}
                onPress={() => {
                  if (!movePickerFor) return;
                  onMove(movePickerFor.playerId, movePickerFor.from, zone.id);
                  setMovePickerFor(null);
                }}
                className="flex-row items-center justify-between rounded-md border px-3 py-3"
                style={{
                  backgroundColor: colors.tile,
                  borderColor: colors.border,
                  opacity: isCurrent ? 0.4 : 1,
                }}
              >
                <View className="flex-row items-center gap-2">
                  <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: zone.accent }} />
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {zone.name}
                  </Text>
                </View>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {isCurrent ? 'current' : `${zone.playerIds.length} players`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

function ZoneBin({
  zone,
  focused,
  hovered,
  colors,
  onPress,
  onFrame,
}: {
  zone: Zone;
  focused: boolean;
  hovered: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPress: () => void;
  onFrame: (zoneId: string, frame: Frame) => void;
}) {
  const ref = useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLayout={() => {
        // Window coords, so the drag can hit-test against them without caring
        // how deeply either side is nested.
        ref.current?.measureInWindow((x, y, width, height) => onFrame(zone.id, { x, y, width, height }));
      }}
      className="rounded-xl border px-3 py-2 mr-2 mb-2"
      style={{
        backgroundColor: hovered ? `${colors.primary}22` : colors.tile,
        borderColor: hovered ? colors.primary : focused ? zone.accent : colors.border,
        borderWidth: hovered || focused ? 2 : 1,
        minWidth: 104,
      }}
    >
      <View className="flex-row items-center gap-1.5">
        <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: zone.accent }} />
        <Text className="text-xs font-bold" numberOfLines={1} style={{ color: colors.ink }}>
          {zone.name}
        </Text>
      </View>
      <Text className="text-[11px] mt-0.5" style={{ color: colors.inkMuted }}>
        {zone.playerIds.length} {zone.playerIds.length === 1 ? 'player' : 'players'}
        {zone.avg ? ` · Avg ${zone.avg}` : ''}
      </Text>
    </Pressable>
  );
}

function DraggableRow({
  playerId,
  player,
  overall,
  accent,
  colors,
  isDragging,
  onHold,
  onTap,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  playerId: string;
  player: Player | undefined;
  overall: number | undefined;
  accent: string;
  colors: ReturnType<typeof useThemeColors>;
  isDragging: boolean;
  /** Reports whether a hold long enough to become a drag is in progress. */
  onHold: (holding: boolean) => void;
  onTap: () => void;
  onDragStart: (windowX: number, windowY: number) => void;
  onDragMove: (windowX: number, windowY: number) => void;
  onDragEnd: (windowX: number, windowY: number) => void;
}) {
  // `armed` flips when the press has been held long enough to mean a drag.
  // Until then the responder stays unclaimed so the FlatList can scroll and a
  // quick tap can open the move sheet.
  const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragged = useRef(false);

  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Every way a touch can end lands here, so the list is never left locked.
  const endHold = () => {
    cancelTimer();
    armed.current = false;
    onHold(false);
  };

  const responder = useRef(
    PanResponder.create({
      // Capture without claiming: returning false leaves the touch to the list
      // and to the row's own tap, while still giving us the moment it started
      // so the hold can be timed.
      onStartShouldSetPanResponderCapture: () => {
        dragged.current = false;
        armed.current = false;
        cancelTimer();
        timer.current = setTimeout(() => {
          armed.current = true;
          onHold(true);
        }, LONG_PRESS_MS);
        return false;
      },
      onMoveShouldSetPanResponder: (_e, g) => {
        // Moving before the hold completes is a scroll: drop the pending drag
        // and let the list have the gesture.
        if (!armed.current) {
          if (Math.abs(g.dy) > SCROLL_SLOP || Math.abs(g.dx) > SCROLL_SLOP) cancelTimer();
          return false;
        }
        return true;
      },
      onPanResponderGrant: (_e, g) => {
        dragged.current = true;
        onDragStart(g.moveX || g.x0, g.moveY || g.y0);
      },
      onPanResponderMove: (_e, g) => {
        onDragMove(g.moveX, g.moveY);
      },
      onPanResponderRelease: (_e, g) => {
        endHold();
        onDragEnd(g.moveX, g.moveY);
      },
      onPanResponderTerminate: (_e, g) => {
        endHold();
        onDragEnd(g.moveX, g.moveY);
      },
      // Nothing else should be able to take the row away mid-drag.
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const name = player ? playerDisplayName(player) : playerId;

  return (
    <View {...responder.panHandlers} onTouchEnd={endHold} onTouchCancel={endHold}>
      <Pressable
        onPress={() => {
          endHold();
          // A completed drag ends in a release too; without this the move sheet
          // would open on top of the drop the coach just made.
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onTap();
        }}
        className="flex-row items-center gap-2 rounded-xl border px-3 py-2.5 mb-1.5"
        style={{
          backgroundColor: colors.tile,
          borderColor: isDragging ? colors.primary : colors.border,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        <View style={{ width: 4, height: 28, borderRadius: 2, backgroundColor: accent }} />
        <View className="flex-1">
          <Text className="text-sm font-bold" numberOfLines={1} style={{ color: colors.ink }}>
            {name}
          </Text>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            {[player?.jersey ? `#${player.jersey}` : null, player?.pos || null].filter(Boolean).join(' · ') || '-'}
          </Text>
        </View>
        {overall != null && overall > 0 ? <Badge label={overall.toFixed(1)} variant="success" /> : null}
        <Text className="text-lg" style={{ color: colors.inkFaint }}>
          ⋮⋮
        </Text>
      </Pressable>
    </View>
  );
}
