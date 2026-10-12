import { Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Avatar, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import { usePlayerProfileQuery, usePlayerReportCardsQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import { slugify } from '@/lib/exportCsv';
import { formatBirth } from '@/lib/birthDate';
import { playerDisplayName } from '@/data/rubrics';
import { formatHeight } from '@/lib/height';

function Row({ label, value, colors }: { label: string; value?: string; colors: any }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-sm" style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="text-sm font-medium flex-1 text-right" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '-'}
      </Text>
    </View>
  );
}

export default function PlayerProfileScreen() {
  const route = useRoute<any>();
  const { athleteId, alsoAthleteIds } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const { isGuardian } = usePermissions();
  const profileQuery = usePlayerProfileQuery(athleteId, alsoAthleteIds);
  const profile = profileQuery.data;
  const reportCardsQuery = usePlayerReportCardsQuery(isGuardian ? undefined : athleteId);
  const reportCards = reportCardsQuery.data ?? [];

  if (profileQuery.isLoading) return <LoadingState />;
  if (profileQuery.isError || !profile) {
    return <ErrorState message="Player not found." onRetry={() => profileQuery.refetch()} />;
  }

  return (
    <Screen scroll>
      <Header title={playerDisplayName(profile)} showBack onBack={() => navigation.goBack()} />

      <View className="items-center py-4 gap-2">
        <Avatar first={profile.first} last={profile.last} pos={profile.currentPosition} size={72} uri={profile.avatarUrl} />
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          #{profile.jersey ?? '-'} · {profile.currentPosition ?? '-'}
        </Text>
      </View>

      <Card className="mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Details
        </Text>
        <Row label="Current Team" value={profile.currentTeam} colors={colors} />
        {profile.teams.length > 1 ? (
          <Row
            label="All Teams"
            value={profile.teams.map((t) => t.teamName).join(', ')}
            colors={colors}
          />
        ) : null}
        <Row label="Position" value={profile.currentPosition} colors={colors} />
        <Row label="Date of Birth" value={formatBirth(profile.dateOfBirth, profile.yearOfBirth)} colors={colors} />
        <Row label="Height" value={formatHeight(profile.heightCm)} colors={colors} />
        <Row label="Player Email" value={profile.playerEmail} colors={colors} />
        <Row label="Guardian" value={profile.guardianName} colors={colors} />
        <Row label="Guardian Email" value={profile.guardianEmail} colors={colors} />
        <Row label="Guardian Phone" value={profile.guardianPhone} colors={colors} />
      </Card>

      {/* The full screens sit one tap away: edit, family contacts and invites on
          the team's player card; scores, report cards and letters on the
          evaluation's. Guardians have their own portal and never see these. */}
      {isGuardian || (profile.teams.length === 0 && profile.assessments.length === 0) ? null : (
        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Manage Player
          </Text>
          {profile.teams.map((t) => (
            <Button
              key={`team-${t.teamId}`}
              label={`Edit on ${t.teamName}`}
              variant="secondary"
              onPress={() => navigation.navigate('TeamPlayer', { id: t.teamId, playerId: athleteId })}
            />
          ))}
          {profile.assessments.map((a) => (
            <Button
              key={`eval-${a.participantId}`}
              label={`Reports in ${a.tryoutName}`}
              variant="ghost"
              onPress={() =>
                navigation.navigate('AssessmentFlow', {
                  screen: 'AssessmentPlayer',
                  params: { id: a.tryoutId, playerId: a.participantId },
                })
              }
            />
          ))}
        </Card>
      )}

      {/* Saved report cards, listed here so a coach finds them again from the
          player card, not only inside an evaluation. */}
      {isGuardian || profile.assessments.length === 0 ? null : (
        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Report Cards
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {reportCards.length === 0
              ? 'No report cards yet. Create one from an evaluation to share with the family.'
              : `${reportCards.length} saved report card${reportCards.length === 1 ? '' : 's'}.`}
          </Text>
          {reportCards.slice(0, 5).map((c) => (
            <Text key={c.id} className="text-sm" style={{ color: colors.ink }} numberOfLines={1}>
              {c.title} · {new Date(c.updatedAt).toLocaleDateString()}
            </Text>
          ))}
          {profile.assessments.map((a) => (
            <Button
              key={`rc-${a.participantId}`}
              label={`Report cards in ${a.tryoutName}`}
              variant="secondary"
              onPress={() =>
                navigation.navigate('AssessmentFlow', {
                  screen: 'AssessmentReportCard',
                  params: { id: a.tryoutId, playerId: a.participantId },
                })
              }
            />
          ))}
        </Card>
      )}

      {profile.canViewMedical ? (
        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Additional Info
          </Text>
          <Row label="Medical" value={profile.medicalInfo} colors={colors} />
        </Card>
      ) : null}

      {/* Assessment history is scores: the season-over-season averages, the
          trend and every evaluation's overall. It belongs to the coach who ran
          the assessments, so guardians get the profile without it rather than a
          read-only copy of it, they see the event's date, time and location in
          their own portal, and their athlete's results from the coach directly.
          Rows are non-interactive for everyone here, this profile is a
          read-only summary, not an entry point into the scoring flow. */}
      {isGuardian ? null : (
        <AssessmentHistory
          assessments={profile.assessments}
          colors={colors}
          exportFileName={slugify(profile.first, profile.last)}
        />
      )}
    </Screen>
  );
}
