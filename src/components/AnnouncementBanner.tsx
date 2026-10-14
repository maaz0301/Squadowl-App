import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useActiveAnnouncementsQuery, type AnnouncementSeverity } from '@/features/announcements';
import { getJson, setJson } from '@/lib/storage';

const DISMISSED_KEY = 'dismissedAnnouncements';

const TONE: Record<AnnouncementSeverity, { bg: string; border: string }> = {
  info: { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.35)' },
  warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)' },
  critical: { bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.45)' },
};

/**
 * Live founder announcements (posted in the Founder Console on web), shown to
 * every signed-in user. Critical ones can't be dismissed. Same behaviour as the
 * web app's AnnouncementBanner.
 */
export function AnnouncementBanner({ enabled = true }: { enabled?: boolean }) {
  const colors = useThemeColors();
  const { data } = useActiveAnnouncementsQuery(enabled);
  const [dismissed, setDismissed] = useState<string[]>(() => getJson<string[]>(DISMISSED_KEY, []));

  const visible = (data ?? []).filter((a) => a.severity === 'critical' || !dismissed.includes(a.id));
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    // Only live ids are kept, so the list can't grow forever.
    const next = [...dismissed.filter((d) => data?.some((a) => a.id === d)), id];
    setDismissed(next);
    setJson(DISMISSED_KEY, next);
  };

  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      {visible.map((a) => (
        <View
          key={a.id}
          accessibilityRole={a.severity === 'critical' ? 'alert' : undefined}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            borderRadius: 12,
            borderWidth: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: TONE[a.severity].bg,
            borderColor: TONE[a.severity].border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{a.title}</Text>
            <Text style={{ color: colors.inkMuted, fontSize: 14 }}>{a.message}</Text>
          </View>
          {a.severity !== 'critical' ? (
            <Pressable accessibilityLabel="Dismiss announcement" hitSlop={10} onPress={() => dismiss(a.id)}>
              <Text style={{ color: colors.inkMuted, fontSize: 22, lineHeight: 22 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}
