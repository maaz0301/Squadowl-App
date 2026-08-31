import { useRoute } from '@react-navigation/native';
import { ScrollView, Text, View } from 'react-native';

import { Avatar, Badge, Card, EmptyState, Header, LoadingState, Screen } from '@/components/ui';
import { useTeamRosterQuery, useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { TeamBanner } from '@/components/TeamBanner';
import { teamBrandSurfaces } from '@/lib/teamBrand';
import { BottomNav } from '@/components/BottomNav';

function Row({ label, value, colors }: { label: string; value?: string; colors: any }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-sm" style={{ color: colors.inkMuted }}>{label}</Text>
      <Text className="text-sm font-medium flex-1 text-right" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </Text>
    </View>
  );
}

export default function TeamPlayerScreen() {
  const route = useRoute<any>();
  const { id: teamId, playerId } = route.params || {};
  const colors = useThemeColors();

  const rosterQuery = useTeamRosterQuery(teamId);
  // Guardian, medical, and "about" details live on the assessment-roster Player
  // record, not the team_roster row — look it up by athleteId across every
  // assessment, since a team's roster can be sourced from more than one.
  const tryoutsQuery = useTryoutsQuery(false);
  // The player card is reached from the team hub, so it keeps the team's
  // branding rather than dropping back to the plain theme mid-flow.
  const teamsQuery = useTeamsQuery();
  const team = teamsQuery.data?.find((t) => t.id === teamId);
  const brand = teamBrandSurfaces(team?.brandColor, colors);

  if (rosterQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState />;

  const rosterEntry = rosterQuery.data?.find((p) => p.athleteId === playerId);
  const fullPlayer = tryoutsQuery.data?.flatMap((t) => t.roster).find((p) => p.athleteId === playerId);

  if (!rosterEntry && !fullPlayer) {
    return (
      <Screen padded={false}>
        <View className="flex-1 px-4">
          <Header title="Player" showBack />
          <EmptyState title="Player not found" message="This player may have been removed from the team." />
        </View>
        <BottomNav active="teams" />
      </Screen>
    );
  }

  const first = rosterEntry?.first ?? fullPlayer?.first ?? '';
  const last = rosterEntry?.last ?? fullPlayer?.last ?? '';
  const pos = rosterEntry?.pos ?? fullPlayer?.pos;
  const jersey = rosterEntry?.jersey ?? fullPlayer?.jersey;
  const yearOfBirth = rosterEntry?.yearOfBirth != null ? String(rosterEntry.yearOfBirth) : fullPlayer?.yearOfBirth;

  return (
    <Screen padded={false} backgroundColor={brand.screenBg}>
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Header
          title={`${first} ${last}`.trim() || 'Player'}
          showBack
        />
        {team ? <TeamBanner team={team} className="mb-3" /> : null}

        <View className="items-center py-4 gap-2">
          <Avatar first={first} last={last} pos={pos} size={72} uri={fullPlayer?.avatarUrl} />
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            #{jersey ?? '—'} · {pos ?? '—'}
          </Text>
          {fullPlayer?.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
        </View>

        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>Details</Text>
          <Row label="Year of Birth" value={yearOfBirth} colors={colors} />
          <Row label="Evaluation" value={rosterEntry?.sourceTryoutName} colors={colors} />
          <Row label="Jersey Colour" value={fullPlayer?.jerseyColour} colors={colors} />
        </Card>

        <Card className="mb-4 gap-2">
          <View className="flex-row justify-between items-center">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>Guardian</Text>
            <Badge
              label={fullPlayer?.linkedGuardianId ? 'Account Linked' : 'Not Linked'}
              variant={fullPlayer?.linkedGuardianId ? 'success' : 'default'}
            />
          </View>
          <Row label="Name" value={fullPlayer?.guardianName} colors={colors} />
          <Row label="Email" value={fullPlayer?.guardianEmail} colors={colors} />
          <Row label="Phone" value={fullPlayer?.guardianPhone} colors={colors} />
        </Card>

        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>Additional Info</Text>
          <Row label="About" value={fullPlayer?.aboutChild} colors={colors} />
          <Row label="Medical" value={fullPlayer?.medicalInfo} colors={colors} />
        </Card>

      </ScrollView>

      <BottomNav active="teams" />
    </Screen>
  );
}
