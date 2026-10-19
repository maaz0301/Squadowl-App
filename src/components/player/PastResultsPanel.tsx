import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Badge, Card } from '@/components/ui';
import { usePlayerProfileQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A player's earlier evaluation and fitness results, shown while scoring them
 * again. Every result names the team, the evaluation and the date it came from;
 * the player is one person across every team they are linked to, so this is the
 * same history wherever they are scored. Collapsed until opened.
 */
export function PastResultsPanel({ athleteId, excludeTryoutId }: { athleteId?: string; excludeTryoutId?: string }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const profile = usePlayerProfileQuery(athleteId);
  const past = (profile.data?.assessments ?? []).filter((a) => a.evalCount > 0 && a.tryoutId !== excludeTryoutId);
  if (!athleteId || past.length === 0) return null;

  return (
    <Card className="mb-4">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between"
      >
        <Text className="font-bold" style={{ color: colors.ink }}>
          Past results ({past.length})
        </Text>
        <Text className="text-sm font-bold" style={{ color: colors.primary }}>
          {open ? 'Hide' : 'Show'}
        </Text>
      </Pressable>
      {open ? (
        <View className="mt-3 gap-3">
          {past.map((a) => (
            <View key={a.tryoutId} className="gap-0.5">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                  {a.tryoutName}
                </Text>
                {a.latestRecommendation ? <Badge label={a.latestRecommendation} variant="brand" /> : null}
              </View>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {[a.teamName, a.eventType, a.date || 'No date'].filter(Boolean).join(' · ')}
              </Text>
              <Text className="text-sm" style={{ color: colors.ink }}>
                Overall {a.overall.toFixed(1)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
