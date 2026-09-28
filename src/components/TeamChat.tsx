import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { EmptyState, ErrorState } from '@/components/ui';
import {
  useDeleteTeamMessageMutation,
  useSendTeamMessageMutation,
  useTeamChatRealtimeSync,
  useTeamMessagesQuery,
} from '@/features/queries';
import { useAuthStore } from '@/state/authStore';
import { useChatReadStore } from '@/state/chatReadStore';
import type { TeamMessage } from '@/data/types';

/** Messages closer together than this stay in one visual run. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Per-author name colors, WhatsApp-style, so a busy team roster stays readable. */
const NAME_COLORS = [
  '#e5786d', '#4ea1d3', '#7fb069', '#c58ad0', '#e0a458',
  '#5bc0be', '#d96c8f', '#8d99ea', '#63b7af', '#dba159',
];

function nameColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** The little pointer on the first bubble of a run. */
function Tail({ mine, color }: { mine: boolean; color: string }) {
  return (
    <Svg
      width={9}
      height={13}
      viewBox="0 0 9 13"
      style={{ position: 'absolute', top: 0, [mine ? 'right' : 'left']: -8 }}
    >
      <Path d={mine ? 'M0 0 H9 L0 13 Z' : 'M9 0 H0 L9 13 Z'} fill={color} />
    </Svg>
  );
}

function DayPill({ label, colors, isDark }: { label: string; colors: any; isDark: boolean }) {
  return (
    <View className="items-center my-3">
      <View
        className="rounded-lg px-3 py-1"
        style={{ backgroundColor: isDark ? 'rgba(12,21,40,0.85)' : 'rgba(255,255,255,0.92)' }}
      >
        <Text className="text-xs font-semibold" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function Bubble({
  message,
  mine,
  startsRun,
  colors,
  isDark,
  onLongPress,
}: {
  message: TeamMessage;
  mine: boolean;
  startsRun: boolean;
  colors: any;
  isDark: boolean;
  onLongPress: () => void;
}) {
  // Outgoing keeps the brand tint (WhatsApp's own green would fight the palette);
  // incoming is the neutral surface, same contrast relationship as the original.
  const bubbleColor = mine
    ? isDark
      ? '#5c2c16'
      : '#ffe2d1'
    : isDark
      ? '#1b2740'
      : '#ffffff';
  const textColor = mine ? (isDark ? '#ffece0' : '#3d1a06') : colors.ink;
  // Timestamps stay quiet but must still clear WCAG AA against their own
  // bubble: inkFaint only manages 2.9:1 on a white incoming bubble, and the
  // outgoing meta needs 0.65 alpha rather than 0.5 to clear it on the peach.
  const metaColor = mine ? (isDark ? 'rgba(255,236,224,0.6)' : 'rgba(61,26,6,0.65)') : colors.inkMuted;
  // Derived once so the reserve below and the rendered string can't disagree.
  const timeText = clockTime(message.createdAt);

  return (
    <View className={`px-2 ${mine ? 'items-end' : 'items-start'}`} style={{ marginTop: startsRun ? 8 : 2 }}>
      <Pressable onLongPress={mine ? onLongPress : undefined} delayLongPress={350} className="max-w-[82%]">
        <View
          style={{
            backgroundColor: bubbleColor,
            borderRadius: 8,
            // Square off the corner the tail attaches to.
            borderTopRightRadius: mine && startsRun ? 0 : 8,
            borderTopLeftRadius: !mine && startsRun ? 0 : 8,
            paddingHorizontal: 9,
            paddingTop: 6,
            paddingBottom: 5,
            elevation: 1,
            shadowColor: '#000',
            shadowOpacity: isDark ? 0.25 : 0.08,
            shadowRadius: 1,
            shadowOffset: { width: 0, height: 1 },
          }}
        >
          {startsRun ? <Tail mine={mine} color={bubbleColor} /> : null}

          {/* Only incoming messages need attribution, and only once per run. */}
          {!mine && startsRun ? (
            <Text className="text-[13px] font-bold mb-0.5" style={{ color: nameColor(message.authorUserId) }}>
              {message.authorName}
              {message.authorRole === 'coach' ? (
                <Text className="text-[11px] font-semibold" style={{ color: colors.inkMuted }}>
                  {'  '}Coach
                </Text>
              ) : null}
            </Text>
          ) : null}

          {/* Reserve room on the last line so the timestamp can sit in the
              corner. Measured from the rendered string rather than a fixed
              constant, "12:53 PM", 24-hour clocks and longer locale formats
              are all wider than the 7-character case, and when the reserve
              falls short the time prints on top of the message text. */}
          <Text
            className="text-[15px] leading-5"
            style={{ color: textColor, paddingRight: timeText.length * 6.4 + 16 }}
          >
            {message.body}
          </Text>
          <Text
            className="text-[11px]"
            style={{ color: metaColor, position: 'absolute', right: 9, bottom: 5 }}
          >
            {timeText}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * Team chat for a season. Everyone `can_access_season()` admits — the team's
 * coaching staff and the guardians of the athletes on its roster — reads and
 * posts here, so a coach's team screen and a guardian's portal render the same
 * conversation from the same component.
 */
export function TeamChat({
  seasonId,
  noSeasonMessage = 'This athlete has not been added to a team yet. Once a coach adds them to a roster, the team chat opens up here.',
}: {
  seasonId?: string;
  /** Shown when there's no season to chat in — the fix differs by audience. */
  noSeasonMessage?: string;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.session?.user?.id);
  const [draft, setDraft] = useState('');

  const messagesQuery = useTeamMessagesQuery(seasonId);
  const sendMessage = useSendTeamMessageMutation();
  const deleteMessage = useDeleteTeamMessageMutation(seasonId ?? '');
  useTeamChatRealtimeSync(seasonId);

  // Having the conversation on screen is what counts as reading it, so the
  // cursor follows the newest loaded message rather than waiting for a scroll
  // to the bottom — the list mounts pinned to the newest message anyway. Runs
  // on every load, not just the first, so messages arriving while the screen
  // is open don't re-badge it the moment the user backs out.
  const markChatRead = useChatReadStore((s) => s.markChatRead);
  useEffect(() => {
    const loaded = messagesQuery.data;
    if (!seasonId || !loaded?.length) return;
    markChatRead(seasonId, loaded[loaded.length - 1].createdAt);
  }, [seasonId, messagesQuery.data, markChatRead]);

  // The list renders inverted so it pins to the newest message and grows
  // upward, which needs newest-first data. Each row also carries the grouping
  // decisions, which depend on the *chronologically previous* message — that's
  // the next index once reversed.
  const rows = useMemo(() => {
    const chronological = messagesQuery.data ?? [];
    const reversed = [...chronological].reverse();
    return reversed.map((message, i) => {
      const previous = reversed[i + 1]; // chronologically earlier
      const showDay = !previous || !sameDay(new Date(previous.createdAt), new Date(message.createdAt));
      const startsRun =
        showDay ||
        previous.authorUserId !== message.authorUserId ||
        message.createdAt - previous.createdAt > GROUP_WINDOW_MS;
      return { message, showDay, startsRun };
    });
  }, [messagesQuery.data]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !seasonId) return;
    setDraft('');
    try {
      await sendMessage.mutateAsync({ seasonId, body });
    } catch (e: any) {
      setDraft(body);
      Alert.alert('Message Not Sent', e?.message || 'Please try again.');
    }
  };

  const confirmDelete = (message: TeamMessage) => {
    Alert.alert('Delete Message', 'Remove this message for everyone on the team?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMessage.mutateAsync(message.id);
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not delete this message.');
          }
        },
      },
    ]);
  };

  if (!seasonId) {
    return <EmptyState title="No team chat yet" message={noSeasonMessage} />;
  }

  if (messagesQuery.isError) {
    return <ErrorState message="Could not load the team chat." onRetry={() => messagesQuery.refetch()} />;
  }

  // Stands in for WhatsApp's wallpaper: a surface distinct from the screen so
  // the bubbles read as a conversation rather than as page content.
  const wallpaper = isDark ? '#0b1220' : '#e7ecf5';

  return (
    <View className="flex-1">
      <View className="flex-1 -mx-4" style={{ backgroundColor: wallpaper }}>
        {messagesQuery.isLoading ? (
          <View className="flex-1 items-center justify-center gap-2">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Loading messages...
            </Text>
          </View>
        ) : rows.length === 0 ? (
          // Rendered outside the list rather than as ListEmptyComponent: an
          // inverted FlatList flips its empty component upside down too.
          <View className="flex-1 justify-center">
            <EmptyState
              title="No messages yet"
              message="Say hello, everyone on the roster and their guardians will see it."
            />
          </View>
        ) : (
          <FlatList
            className="flex-1"
            inverted
            data={rows}
            keyExtractor={(r) => r.message.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 8 }}
            renderItem={({ item }) => (
              <View>
                {/* Inverted: this renders above its own bubble, which is where
                    the separator for a new day belongs. */}
                {item.showDay ? (
                  <DayPill label={dayLabel(item.message.createdAt)} colors={colors} isDark={isDark} />
                ) : null}
                <Bubble
                  message={item.message}
                  mine={item.message.authorUserId === currentUserId}
                  startsRun={item.startsRun}
                  colors={colors}
                  isDark={isDark}
                  onLongPress={() => confirmDelete(item.message)}
                />
              </View>
            )}
          />
        )}
      </View>

      {/* -mx-4 cancels the screen's own 16px side padding (see the px-4
          wrapper in team/[id].tsx and guardian/[playerId].tsx) so px-2 below
          can re-establish the mockup's 8px inset from the true screen edge,
          matching how the message wall bleeds full-width above it.
          paddingBottom is explicit rather than `py-2` because this composer
          sits at the true bottom edge (TeamChatScreen's <Screen> only
          reserves the top/left/right safe-area edges, not bottom, chat is
          the one screen where that matters, since every other screen scrolls
          under its own bottom padding instead of pinning content there), so
          it has to reserve the home-indicator/nav-bar inset itself, the same
          way BottomNav.tsx does. */}
      <View
        className="flex-row items-end gap-2 -mx-4 px-2 pt-2"
        style={{ paddingBottom: Math.max(8, insets.bottom) }}
      >
        <TextInput
          className="flex-1 px-4 py-[11px] text-[15px] max-h-28"
          placeholder="Message"
          placeholderTextColor={colors.placeholder}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={2000}
          underlineColorAndroid="transparent"
          style={{
            backgroundColor: isDark ? '#1b2740' : '#ffffff',
            color: colors.ink,
            minHeight: 44,
            borderRadius: 30,
          }}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sendMessage.isPending}
          className="rounded-full items-center justify-center"
          style={{
            backgroundColor: colors.primary,
            opacity: !draft.trim() || sendMessage.isPending ? 0.5 : 1,
            width: 44,
            height: 44,
          }}
          accessibilityLabel="Send message"
        >
          {sendMessage.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path d="M3 20.5v-6l8-2.5-8-2.5v-6l19 8.5-19 8.5z" fill="#fff" />
            </Svg>
          )}
        </Pressable>
      </View>
    </View>
  );
}
