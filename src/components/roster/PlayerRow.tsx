import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Avatar, positionColor } from '@/components/ui';
import { playerDisplayName } from '@/data/rubrics';
import type { Player } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { ChevronIcon } from './icons';

/**
 * One player in the roster list.
 *
 * Memoised, and taking the eval count rather than the evals it came from,
 * because this renders a thousand times on a big tryout: anything that makes a
 * row re-render when a different row's data changes is felt as a stutter while
 * scrolling.
 */
export const PlayerRow = memo(function PlayerRow({
  player,
  evalCount,
  onPress,
}: {
  player: Player;
  evalCount: number;
  onPress: (playerId: string) => void;
}) {
  const colors = useThemeColors();
  const scored = evalCount > 0;
  const posAccent = positionColor(player.pos, colors.inkMuted);

  return (
    <Pressable
      onPress={() => onPress(player.id)}
      accessibilityRole="button"
      accessibilityLabel={`${playerDisplayName(player)}, ${scored ? `${evalCount} evaluations` : 'unscored'}`}
      className="mb-2 flex-row items-center gap-3 rounded-2xl border px-3 py-3 active:opacity-70"
      style={{ backgroundColor: colors.card, borderColor: colors.border }}
    >
      <Avatar first={player.first} last={player.last} pos={player.pos} uri={player.avatarUrl} />

      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-bold" style={{ color: colors.ink }}>
          {playerDisplayName(player)}
        </Text>
        <View className="mt-1 flex-row items-center gap-1.5">
          <Text className="font-mono text-xs" style={{ color: colors.inkMuted }}>
            #{player.jersey ?? '—'}
          </Text>
          {player.pos ? (
            <View
              className="rounded-md px-1.5 py-0.5"
              style={{ backgroundColor: `${posAccent}22` }}
            >
              <Text className="text-xs font-bold" style={{ color: posAccent }}>
                {player.pos.toUpperCase()}
              </Text>
            </View>
          ) : null}
          {player.registrationSource === 'qr' ? (
            <View className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: 'rgba(56,189,248,0.14)' }}>
              <Text className="text-xs font-bold" style={{ color: colors.info }}>
                QR
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Scored and unscored read as two different states, not two labels: a
          filled count against a hollow dash, so a half-scored roster can be
          skimmed down the right edge without reading a word of it. */}
      {scored ? (
        <View
          className="flex-row items-center gap-1 rounded-lg border px-2 py-1.5"
          style={{ backgroundColor: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.28)' }}
        >
          <Text className="text-sm font-extrabold" style={{ color: colors.success }}>
            {evalCount}
          </Text>
          <Text
            className="text-[10px] font-bold uppercase"
            style={{ color: colors.success, letterSpacing: 0.4, opacity: 0.85 }}
          >
            {evalCount === 1 ? 'eval' : 'evals'}
          </Text>
        </View>
      ) : (
        <View
          className="flex-row items-center gap-1 rounded-lg border border-dashed px-2 py-1.5"
          style={{ borderColor: colors.border, backgroundColor: 'transparent' }}
        >
          <Text className="text-sm font-extrabold" style={{ color: colors.inkFaint }}>
            —
          </Text>
          <Text
            className="text-[10px] font-bold uppercase"
            style={{ color: colors.inkFaint, letterSpacing: 0.4, opacity: 0.85 }}
          >
            unscored
          </Text>
        </View>
      )}

      <ChevronIcon color={colors.inkFaint} size={16} />
    </Pressable>
  );
});
