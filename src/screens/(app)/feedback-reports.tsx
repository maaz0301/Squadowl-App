import { useMemo, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Screen,
} from '@/components/ui';
import { useFeedbackSubmissionsQuery, useIsFeedbackReviewerQuery } from '@/features/queries';
import { getDataSource } from '@/data';
import type { FeedbackAttachment, FeedbackReport } from '@/data/extras';

const RATINGS: [keyof Pick<
  FeedbackReport,
  'overallExperience' | 'easeOfUse' | 'teamHubScheduling' | 'valueForMoney'
>, string][] = [
  ['overallExperience', 'Overall'],
  ['easeOfUse', 'Ease of use'],
  ['teamHubScheduling', 'Team Hub'],
  ['valueForMoney', 'Value'],
];

/** Red below 3, amber at 3, green above — the same reading as the score heat elsewhere. */
function ratingVariant(score: number): 'danger' | 'warning' | 'success' {
  if (score <= 2) return 'danger';
  if (score === 3) return 'warning';
  return 'success';
}

/** The same three bands as hex, for the rails and bars that badges can't express. */
const TONE_HEX = { danger: '#f87171', warning: '#fb923c', success: '#22c55e' } as const;

function toneHex(score: number): string {
  return TONE_HEX[ratingVariant(score)];
}

/** "Jane Smith" → ["Jane", "Smith"]; an email or a single word still yields something to draw. */
function nameParts(report: FeedbackReport): [string, string] {
  const source = report.displayName || report.email || '?';
  const [first = '?', last = ''] = source.split(/[\s@.]+/).filter(Boolean);
  return [first, last];
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function averageOf(report: FeedbackReport): number {
  return (
    (report.overallExperience + report.easeOfUse + report.teamHubScheduling + report.valueForMoney) / 4
  );
}

/** One headline number in the summary strip above the list. */
function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  const colors = useThemeColors();
  return (
    <Card className="flex-1 px-3 py-2.5">
      <Text className="font-display font-bold text-2xl" style={{ color }}>
        {value}
      </Text>
      <Text className="text-xs" style={{ color: colors.inkMuted }}>
        {label}
      </Text>
    </Card>
  );
}

/**
 * Every feedback submission, for the handful of people on the
 * `feedback_reviewers` allowlist.
 *
 * The gate is drawn twice on purpose. The database is the real one — the select
 * policy on `feedback_submissions` returns a non-reviewer only their own rows,
 * so there is nothing to leak even if this screen rendered for them — and the
 * check below is what keeps a coach who reaches the route from seeing a screen
 * that looks like it was meant for them.
 */
export default function FeedbackReportsScreen() {
  const colors = useThemeColors();
  const reviewerQuery = useIsFeedbackReviewerQuery();
  const isReviewer = reviewerQuery.data === true;
  const submissionsQuery = useFeedbackSubmissionsQuery(isReviewer);

  const [search, setSearch] = useState('');
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  const reports = useMemo(() => submissionsQuery.data ?? [], [submissionsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      [r.displayName, r.email, r.whatIsWorkingWell, r.whatCanBeImproved]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    );
  }, [reports, search]);

  const openAttachment = async (attachment: FeedbackAttachment) => {
    setOpeningPath(attachment.path);
    try {
      const url = await getDataSource().getFeedbackAttachmentUrl(attachment.path);
      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.open(url, {
          dismissButtonStyle: 'close',
          preferredBarTintColor: colors.bg,
          preferredControlTintColor: colors.primary,
        });
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      Alert.alert('Could not open', e?.message ?? 'That attachment is unavailable.');
    } finally {
      setOpeningPath(null);
    }
  };

  if (reviewerQuery.isLoading) {
    return (
      <Screen scroll>
        <Header title="Feedback Portal" showBack />
        <LoadingState message="Loading..." />
      </Screen>
    );
  }

  if (!isReviewer) {
    return (
      <Screen scroll>
        <Header title="Feedback Portal" showBack />
        <EmptyState
          title="Not available"
          message="This portal is limited to the people who review submitted feedback."
        />
      </Screen>
    );
  }

  const average = reports.length
    ? reports.reduce((sum, r) => sum + averageOf(r), 0) / reports.length
    : null;

  return (
    <Screen scroll>
      <Header
        title="Feedback Portal"
        subtitle={
          reports.length
            ? `${reports.length} submission${reports.length === 1 ? '' : 's'}`
            : undefined
        }
        showBack
      />

      {submissionsQuery.isLoading ? (
        <LoadingState message="Loading feedback..." />
      ) : submissionsQuery.isError ? (
        <ErrorState message="Could not load feedback." onRetry={() => submissionsQuery.refetch()} />
      ) : reports.length === 0 ? (
        <EmptyState title="No feedback yet" message="Submitted surveys will appear here." />
      ) : (
        <View className="mt-4 gap-4">
          {/* One strip of headline numbers: how much feedback there is, how it
              scores overall, and how many came with a screenshot, which is the
              subset worth opening first when triaging bugs. */}
          <View className="flex-row gap-2">
            <StatTile label="Submissions" value={String(reports.length)} color={colors.ink} />
            <StatTile
              label="Average"
              value={average != null ? `${average.toFixed(1)}/5` : '-'}
              color={average != null ? toneHex(Math.round(average)) : colors.ink}
            />
            <StatTile
              label="Low scores"
              value={String(reports.filter((r) => averageOf(r) <= 2.5).length)}
              color={colors.danger}
            />
          </View>

          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email or comment..."
          />

          {filtered.length === 0 ? (
            <EmptyState title="No matches" message={`Nothing matches "${search}".`} />
          ) : (
            filtered.map((report) => {
              const avg = averageOf(report);
              const [first, last] = nameParts(report);
              return (
                <Card
                  key={report.id}
                  className="gap-3"
                  // Rail colour is the submission's own average, so a list of
                  // cards can be triaged by scanning the left edge.
                  style={{ borderLeftWidth: 5, borderLeftColor: toneHex(Math.round(avg)) }}
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1 flex-row items-center gap-2">
                      <Avatar first={first} last={last} size={36} />
                      <View className="flex-1">
                        <Text className="font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                          {report.displayName || report.email || 'Unknown coach'}
                        </Text>
                        {report.displayName && report.email ? (
                          <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                            {report.email}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View className="items-end gap-1">
                      <Badge label={`${avg.toFixed(1)}/5 avg`} variant={ratingVariant(Math.round(avg))} />
                      <Text className="text-xs" style={{ color: colors.inkFaint }}>
                        {formatDate(report.createdAt)}
                      </Text>
                    </View>
                  </View>

                  {/* Bars rather than four more badges: the point of this row is
                      which of the four scores is the low one, and a length is
                      quicker to compare than a number. */}
                  <View className="gap-2">
                    {RATINGS.map(([key, label]) => {
                      const score = report[key];
                      return (
                        <View key={key} className="gap-1">
                          <View className="flex-row items-baseline justify-between">
                            <Text className="text-xs" style={{ color: colors.inkMuted }}>
                              {label}
                            </Text>
                            <Text className="text-xs font-bold" style={{ color: toneHex(score) }}>
                              {score}/5
                            </Text>
                          </View>
                          <View
                            className="h-1.5 overflow-hidden rounded-full"
                            style={{ backgroundColor: colors.tile }}
                          >
                            <View
                              className="h-full rounded-full"
                              style={{ width: `${(score / 5) * 100}%`, backgroundColor: toneHex(score) }}
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {report.whatIsWorkingWell ? (
                    <View>
                      <Text className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        What&apos;s working well
                      </Text>
                      <Text className="text-sm" style={{ color: colors.ink }}>
                        {report.whatIsWorkingWell}
                      </Text>
                    </View>
                  ) : null}

                  {report.whatCanBeImproved ? (
                    <View>
                      <Text className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        What can be improved
                      </Text>
                      <Text className="text-sm" style={{ color: colors.ink }}>
                        {report.whatCanBeImproved}
                      </Text>
                    </View>
                  ) : null}

                  {report.attachments.length > 0 ? (
                    <View className="gap-2">
                      <Text className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        Attachments
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {report.attachments.map((a) => (
                          <Button
                            key={a.path}
                            // The bucket is private, so each tap mints its own
                            // short-lived signed URL rather than the card holding
                            // links that would expire while the screen sat open.
                            label={`${a.contentType === 'application/pdf' ? '📄' : '🖼️'} ${a.name}`}
                            size="sm"
                            variant="secondary"
                            loading={openingPath === a.path}
                            onPress={() => openAttachment(a)}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </Card>
              );
            })
          )}
        </View>
      )}
    </Screen>
  );
}
