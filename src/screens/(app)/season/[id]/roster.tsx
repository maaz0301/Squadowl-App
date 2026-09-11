import { useState } from 'react';
import { FlatList, Pressable, Text, View, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/theme/ThemeProvider';
import { TeamBanner } from '@/components/TeamBanner';
import { useSeasonTeamBrand } from '@/features/useTeamBrand';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Input, LoadingState, Modal, Screen } from '@/components/ui';
import {
  useSeasonQuery,
  useSeasonRosterPagesQuery,
  useAddSeasonPlayerMutation,
  useImportSeasonPlayersFromTeamMutation,
  useSeasonRosterInvitesMutation,
} from '@/features/queries';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';

/** Matches listSeasonRosterPage's own page size — see SEASON_ROSTER_SCREEN_PAGE. */
const SEASON_ROSTER_PAGE = 50;

export default function SeasonRosterScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const seasonQuery = useSeasonQuery(id);
  // The list reads its own paged query rather than season.roster: a season with
  // a club-sized roster took several round trips to assemble that array, and
  // this screen shows a screenful at a time. Both live under the same cache
  // key, so a write that invalidates the season refreshes these pages too.
  const rosterPages = useSeasonRosterPagesQuery(id);
  const addPlayer = useAddSeasonPlayerMutation();
  const importTeam = useImportSeasonPlayersFromTeamMutation();
  const invitePlayers = useSeasonRosterInvitesMutation(id ?? '');
  const [showAdd, setShowAdd] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jersey, setJersey] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  // Hook, so it runs before the loading/error guards — skipping it on the
  // loading render would change hook order. Undefined season -> plain theme.
  const { team, brand } = useSeasonTeamBrand(seasonQuery.data);

  if (seasonQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => seasonQuery.refetch()} />;
  }

  const season = seasonQuery.data;
  const players = rosterPages.data?.pages.flatMap((p) => p.players) ?? [];

  /**
   * Add a player and link them to the portal in one step.
   *
   * The invite is what makes a roster entry useful to the family it names, so
   * it goes out with the add rather than waiting for someone to open the
   * player's profile and press Invite — which is how players ended up on
   * rosters for a whole season with no way into the portal.
   *
   * The player is on the roster whatever the invite does: the form closes
   * first, and only a bounce or a player with no address on file is worth a
   * dialog. A send that simply worked says nothing — a confirmation after every
   * add is noise.
   */
  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    const name = `${firstName.trim()} ${lastName.trim()}`;
    const player = await addPlayer.mutateAsync({
      seasonId: id!,
      player: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jersey: jersey.trim() || undefined,
        playerEmail: playerEmail.trim() || undefined,
        guardianEmail: guardianEmail.trim() || undefined,
      },
    });
    setFirstName('');
    setLastName('');
    setJersey('');
    setPlayerEmail('');
    setGuardianEmail('');
    setShowAdd(false);

    try {
      const result = await invitePlayers.mutateAsync({ playerIds: [player.id] });
      if (inviteNeedsAttention(result)) {
        const { title, message } = describeInviteResult(result);
        Alert.alert(title, message);
      }
    } catch (e: any) {
      Alert.alert(
        'Invite Not Sent',
        `${name} was added to the roster, but the portal invite could not be sent: ${
          e?.message || 'Unknown error'
        }`,
      );
    }
  };

  /**
   * Import the linked team's players, and link each of them to the portal.
   *
   * Same rule as adding one by hand: landing on a roster is what earns an
   * invite. Most of these athletes were already invited when they joined the
   * team, and sendSeasonRosterInvites skips an address that still has a pending
   * invite — so this reaches exactly the players who had no way in yet.
   */
  const handleImport = async () => {
    try {
      const imported = await importTeam.mutateAsync(id!);
      let note = 'Roster players imported successfully from the linked team evaluations.';
      if (imported.length > 0) {
        try {
          const result = await invitePlayers.mutateAsync({ playerIds: imported.map((p) => p.id) });
          if (inviteNeedsAttention(result)) note = `${note}\n\n${describeInviteResult(result).message}`;
        } catch (e: any) {
          note = `${note}\n\nPortal invites could not be sent: ${e?.message || 'Unknown error'}`;
        }
      }
      Alert.alert('Import Complete', note);
    } catch (e: any) {
      Alert.alert('Import Failed', e.message || 'Could not import players.');
    }
  };

  return (
    <Screen padded={false} backgroundColor={brand.screenBg}>
      <Header
        title="Season Roster"
        showBack
        right={
          season.teamId ? (
            <Button
              label="Import Team"
              variant="ghost"
              size="sm"
              loading={importTeam.isPending || invitePlayers.isPending}
              onPress={handleImport}
            />
          ) : undefined
        }
      />
      {team ? <TeamBanner team={team} className="px-4 mb-2" /> : null}
      <FlatList
        data={players}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: Math.max(100, insets.bottom + 80),
          flexGrow: 1,
        }}
        // Cap how much of a large roster is mounted before the first paint.
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        // Scrolling to the end pulls the next page in on its own; the button
        // below is for anyone who stops short of the very bottom.
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (rosterPages.hasNextPage && !rosterPages.isFetchingNextPage) {
            void rosterPages.fetchNextPage();
          }
        }}
        ListFooterComponent={
          rosterPages.hasNextPage ? (
            <Button
              label={`Load ${SEASON_ROSTER_PAGE} more players`}
              variant="secondary"
              loading={rosterPages.isFetchingNextPage}
              onPress={() => void rosterPages.fetchNextPage()}
            />
          ) : null
        }
        ListEmptyComponent={
          // An empty first page can mean "still loading", which must not read
          // as "no players" — least of all with an Import button under it.
          rosterPages.isLoading ? (
            <LoadingState message="Loading roster..." />
          ) : rosterPages.isError ? (
            <ErrorState message="Could not load the roster." onRetry={() => rosterPages.refetch()} />
          ) : (
            <EmptyState
              title="No roster players"
              message={season.teamId ? "Import players from the linked team evaluations or add them manually." : "Add players manually to get started."}
              actionLabel={season.teamId ? "Import from Team" : "Add Player"}
              onAction={season.teamId ? handleImport : () => setShowAdd(true)}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('SeasonPlayer', { id: id, playerId: item.id })}>
            <Card className="mb-2 flex-row justify-between items-center">
              <View>
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {item.firstName} {item.lastName}
                </Text>
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  #{item.jersey ?? '—'} · {item.playerEmail ?? item.guardianEmail ?? 'No email'}
                </Text>
              </View>
              {item.portalInviteSentAt ? (
                <Badge label="Portal invited" variant="success" />
              ) : (
                <Badge label="No invite" variant="warning" />
              )}
            </Card>
          </Pressable>
        )}
      />

      <View
        className="absolute left-4 right-4"
        style={{ bottom: Math.max(24, insets.bottom + 12) }}
      >
        <Button label="+ Add Player" onPress={() => setShowAdd(true)} />
      </View>

      <Modal visible={showAdd} title="Add Season Player" onClose={() => setShowAdd(false)}>
        <View className="gap-3">
          <Input label="First name" value={firstName} onChangeText={setFirstName} />
          <Input label="Last name" value={lastName} onChangeText={setLastName} />
          <Input label="Jersey" value={jersey} onChangeText={setJersey} />
          <Input label="Player email" value={playerEmail} onChangeText={setPlayerEmail} autoCapitalize="none" keyboardType="email-address" />
          <Input label="Guardian email" value={guardianEmail} onChangeText={setGuardianEmail} autoCapitalize="none" keyboardType="email-address" />
          <Button label="Add to Roster" onPress={handleAdd} loading={addPlayer.isPending} />
        </View>
      </Modal>
    </Screen>
  );
}
