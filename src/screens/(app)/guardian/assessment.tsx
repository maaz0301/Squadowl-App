import React from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen, Header, Card, EmptyState, LoadingState, ErrorState } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { MapLink } from '@/components/MapLink';
import { hasMappableLocation } from '@/lib/mapLinks';
import { useGuardianRostersQuery } from '@/features/queries';

function DetailRow({ label, value, colors }: { label: string; value?: string; colors: any }) {
  return (
    <View className="flex-row justify-between gap-3 border-b py-2 last:border-0" style={{ borderBottomColor: colors.border }}>
      <Text className="text-sm" style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </Text>
    </View>
  );
}

/** "5:30 PM – 7:00 PM", or just the start when no end time was set. */
function formatTimeRange(start?: string, end?: string): string | undefined {
  const clock = (t?: string) => (t ? t.slice(0, 5) : undefined);
  const from = clock(start);
  const to = clock(end);
  if (!from) return undefined;
  return to ? `${from} – ${to}` : from;
}

/**
 * What a guardian is shown about an assessment their athlete is in: where and
 * when to turn up, and nothing else. Scores, session results and the coach's
 * make/release recommendation stay with the coach who ran it — the guardian
 * payload doesn't carry them at all (see mapGuardianRosterRow), so there is
 * nothing here to leak.
 */
export default function GuardianAssessmentDetailsScreen() {
  const route = useRoute<any>();
  const { playerId, tryoutId } = route.params || {};
  const colors = useThemeColors();
  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading event details..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load event details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a: any) => a.id === playerId);
  const tryout = athlete?.tryouts?.find((t: any) => t.id === tryoutId);

  if (!athlete || !tryout) {
    return (
      <Screen>
        <Header title="Event Details" showBack />
        <EmptyState title="Not found" message="We couldn't find the details for this event." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2">
        <Header title={tryout.name} showBack />
        <Text className="text-sm font-medium mb-4" style={{ color: colors.inkMuted }}>
          Event Details · {tryout.sport}
        </Text>
      </View>

      <View className="px-4 pb-10">
        <Card className="mb-4">
          <DetailRow label="Athlete" value={`${athlete.firstName} ${athlete.lastName}`} colors={colors} />
          <DetailRow label="Event" value={tryout.name} colors={colors} />
          <DetailRow label="Sport" value={tryout.sport} colors={colors} />
          <DetailRow label="Date" value={tryout.date} colors={colors} />
          <DetailRow label="Time" value={formatTimeRange(tryout.startTime, tryout.endTime)} colors={colors} />
          <DetailRow label="Location" value={tryout.location} colors={colors} />
        </Card>

        {/* The one thing a guardian actually does with this screen on the
            morning of the event, so it gets a row of its own rather than a link
            buried in the detail table above. */}
        {hasMappableLocation(tryout.location) ? (
          <Card className="mb-4 flex-row items-center justify-between gap-3">
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Getting there
            </Text>
            <MapLink location={tryout.location} label={tryout.name} />
          </Card>
        ) : null}

        <Card>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Evaluation scores and results are shared by the coach running this event. Reach out to them directly
            with any questions about your athlete's assessment.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
