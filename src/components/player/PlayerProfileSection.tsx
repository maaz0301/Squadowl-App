import { ActivityIndicator, Text, View } from 'react-native';

import { Button, Card, ErrorState } from '@/components/ui';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import { usePlayerProfileQuery } from '@/features/queries';
import { slugify } from '@/lib/exportCsv';
import { formatBirth } from '@/lib/birthDate';
import { useThemeColors } from '@/theme/ThemeProvider';
import { formatHeight } from '@/lib/height';

/**
 * Everything the full player profile screen shows, inline: the player's details
 * (with an Edit button), then season-over-season, score trend and the
 * evaluation history, each with a View button that opens its record.
 */
export function PlayerProfileSection({
  athleteId,
  onEditDetails,
}: {
  athleteId: string;
  /** Opens the edit form. Omit for a viewer who may not edit. */
  onEditDetails?: () => void;
}) {
  const colors = useThemeColors();
  const profileQuery = usePlayerProfileQuery(athleteId);
  const profile = profileQuery.data;

  if (profileQuery.isLoading) {
    return (
      <Card className="mb-4 flex-row items-center gap-2">
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.inkMuted }}>Loading profile...</Text>
      </Card>
    );
  }
  if (profileQuery.isError || !profile) {
    return <ErrorState message="Could not load this player's profile." onRetry={() => profileQuery.refetch()} />;
  }

  const row = (label: string, value?: string | number | null) => (
    <View className="flex-row justify-between gap-3">
      <Text className="text-sm" style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="text-sm font-medium flex-1 text-right" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '-'}
      </Text>
    </View>
  );

  return (
    <View>
      <Card className="mb-4 gap-2">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>Details</Text>
          {onEditDetails ? <Button label="Edit" variant="secondary" size="sm" onPress={onEditDetails} /> : null}
        </View>
        {row('Date of Birth', formatBirth(profile.dateOfBirth, profile.yearOfBirth))}
        {row('Current Team', profile.currentTeam)}
        {profile.teams.length > 1 ? row('All Teams', profile.teams.map((t) => t.teamName).join(', ')) : null}
        {row('Position', profile.currentPosition)}
        {row('Level', profile.currentLevel)}
        {row('Jersey', profile.jersey)}
        {row('Height', formatHeight(profile.heightCm))}
        {row('Player Email', profile.playerEmail)}
        {row('Guardian', profile.guardianName)}
        {row('Guardian Email', profile.guardianEmail)}
        {row('Guardian Phone', profile.guardianPhone)}
        {profile.pastSeasons.length > 0
          ? row('Seasons', [...new Set(profile.pastSeasons.map((s) => s.seasonName))].join(', '))
          : null}
        {row('About', profile.aboutChild)}
        {profile.canViewMedical ? row('Medical', profile.medicalInfo) : null}
      </Card>

      <AssessmentHistory
        assessments={profile.assessments}
        colors={colors}
        exportFileName={slugify(profile.first, profile.last)}
        viewRecords
      />
    </View>
  );
}
