import { useRoute } from '@react-navigation/native';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';

import { Avatar, Badge, Button, Card, EmptyState, Header, LoadingState, Screen } from '@/components/ui';
import { useTeamRosterPlayerQuery, useTeamRosterInvitesMutation, useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { usePermissions } from '@/state/authStore';
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

  const rosterPlayerQuery = useTeamRosterPlayerQuery(teamId, playerId);
  const sendInvite = useTeamRosterInvitesMutation(teamId);
  const { canManageTeam } = usePermissions();
  // The team_roster row carries everything that lives on the athlete itself —
  // guardian contact, medical notes and the photo included — and the team
  // screen has already loaded it, so this card paints from cache. Only the
  // assessment-scoped extra (how the player registered) still needs the Player
  // record, looked up by athleteId across every assessment since a team's
  // roster can be sourced from more than one. That read is the heaviest query
  // in the app, so nothing below waits on it: the badge fills in when it lands.
  const tryoutsQuery = useTryoutsQuery(false);
  // The player card is reached from the team hub, so it keeps the team's
  // branding rather than dropping back to the plain theme mid-flow.
  const teamsQuery = useTeamsQuery();
  const team = teamsQuery.data?.find((t) => t.id === teamId);
  const brand = teamBrandSurfaces(team?.brandColor, colors);

  const alertMsg = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  /**
   * Invite this one player. Reports per-address, the same way the team screen's
   * whole-roster send does — a player and their guardian are two invites, and
   * one can land while the other bounces.
   */
  const sendPlayerInvite = async () => {
    try {
      const result = await sendInvite.mutateAsync([playerId]);
      if (result.sent.length > 0) {
        alertMsg('Invite Sent', `Invited ${result.sent.join(', ')}.`);
      } else if (result.failed.length > 0) {
        alertMsg('Invite Failed', `Could not send to ${result.failed.map((f) => f.email).join(', ')}.`);
      } else {
        alertMsg('No Email On File', 'Add a player or guardian email to this athlete before inviting them.');
      }
    } catch (e: any) {
      alertMsg('Error', e?.message || 'Could not send invite.');
    }
  };

  if (rosterPlayerQuery.isLoading) return <LoadingState />;

  const rosterEntry = rosterPlayerQuery.data ?? undefined;
  const fullPlayer = tryoutsQuery.data?.flatMap((t) => t.roster).find((p) => p.athleteId === playerId);

  // Only worth waiting on the assessment read for someone the roster doesn't
  // know — a player removed from the team, or a stale deep link.
  if (!rosterEntry && tryoutsQuery.isLoading) return <LoadingState />;

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
  // Link state comes off the athlete row now, so the badge is correct for a
  // player who was never on an assessment roster. The Player record stays as a
  // fallback for the case where only it resolved.
  const guardianLinked = !!(rosterEntry?.linkedGuardianId ?? fullPlayer?.linkedGuardianId);

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
          <Avatar
            first={first}
            last={last}
            pos={pos}
            size={72}
            uri={rosterEntry?.avatarUrl ?? fullPlayer?.avatarUrl}
          />
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            #{jersey ?? '—'} · {pos ?? '—'}
          </Text>
          {fullPlayer?.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
        </View>

        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>Details</Text>
          <Row label="Year of Birth" value={yearOfBirth} colors={colors} />
          <Row label="Player Email" value={rosterEntry?.playerEmail ?? fullPlayer?.playerEmail} colors={colors} />
        </Card>

        <Card className="mb-4 gap-2">
          <View className="flex-row justify-between items-center">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>Guardian</Text>
            <Badge
              label={guardianLinked ? 'Account Linked' : 'Not Linked'}
              variant={guardianLinked ? 'success' : 'default'}
            />
          </View>
          <Row label="Name" value={rosterEntry?.guardianName ?? fullPlayer?.guardianName} colors={colors} />
          <Row label="Email" value={rosterEntry?.guardianEmail ?? fullPlayer?.guardianEmail} colors={colors} />
          <Row label="Phone" value={rosterEntry?.guardianPhone ?? fullPlayer?.guardianPhone} colors={colors} />
        </Card>

        <Card className="mb-4 gap-2">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>Additional Info</Text>
          <Row label="Medical" value={rosterEntry?.medicalInfo ?? fullPlayer?.medicalInfo} colors={colors} />
        </Card>

        {canManageTeam ? (
          <View className="mb-4 gap-2">
            <Button
              label="Send Invite"
              variant="secondary"
              disabled={!rosterEntry?.playerEmail && !rosterEntry?.guardianEmail}
              loading={sendInvite.isPending}
              onPress={sendPlayerInvite}
            />
            {!rosterEntry?.playerEmail && !rosterEntry?.guardianEmail ? (
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Add a player or guardian email to this athlete before inviting them.
              </Text>
            ) : null}
          </View>
        ) : null}

      </ScrollView>

      <BottomNav active="teams" />
    </Screen>
  );
}
