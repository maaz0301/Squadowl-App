import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { useChatUnreadCount } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { cn } from '@/lib/cn';

/**
 * The badge itself, given a count. Split out from the season-bound version
 * below so a caller holding an already-summed total (a guardian whose athlete
 * is on several teams) renders the same pill without a second subscription.
 */
export function UnreadPill({ count, className }: { count: number; className?: string }) {
  const colors = useThemeColors();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={`${count} unread ${count === 1 ? 'message' : 'messages'}`}
      className={cn('rounded-full items-center justify-center px-1.5', className)}
      style={{ backgroundColor: colors.primary, minWidth: 18, height: 18 }}
    >
      <Text className="text-[11px] font-bold" style={{ color: '#fff' }}>
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
}

/**
 * The count of unseen team-chat messages for one season, for the places a Chat
 * entry point lives that don't carry a badge of their own (a coach's team
 * screen, a season hub, a guardian's list of teams).
 *
 * Renders nothing when there is nothing new, so it can sit in the tree
 * unconditionally.
 */
export function ChatUnreadBadge({ seasonId, className }: { seasonId?: string; className?: string }) {
  const unread = useChatUnreadCount(seasonId);
  return <UnreadPill count={unread} className={className} />;
}

/**
 * One season's unread count, reported upward and drawn nowhere.
 *
 * A screen that needs a total across several seasons can't loop the hook
 * itself — that would make its hook count depend on how many teams the athlete
 * is on. One probe per season keeps each subscription inside its own component,
 * and the parent just adds up what they report.
 */
export function ChatUnreadProbe({
  seasonId,
  onCount,
}: {
  seasonId: string;
  onCount: (seasonId: string, count: number) => void;
}) {
  const unread = useChatUnreadCount(seasonId);
  useEffect(() => {
    onCount(seasonId, unread);
  }, [seasonId, unread, onCount]);
  return null;
}
