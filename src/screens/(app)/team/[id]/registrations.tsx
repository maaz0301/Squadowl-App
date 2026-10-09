import { RegistrationProfileModal } from '@/components/assessment/RegistrationProfileModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { PlanGate } from '@/components/PlanGate';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Modal, Screen, Tabs } from '@/components/ui';
import { isAtPlayerLimit, playersTowardCap } from '@/data/plans';
import {
  useAccountPlayerCount,
  useAddTeamRegistrationsMutation,
  useDismissTeamRegistrationMutation,
  useEnsureTeamRegistrationLinkMutation,
  useSetTeamRegistrationOpenMutation,
  useTeamRegistrationsQuery,
  useTeamRosterAthleteIdsQuery,
  useTeamsQuery,
} from '@/features/queries';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useThemeColors } from '@/theme/ThemeProvider';
import { EXPO_PUBLIC_WEB_URL } from '@env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

type RegTab = 'pending' | 'all' | 'dismissed';

/** Registrations made through a team's own sign-up link, ready to be added to its roster. */
export default function TeamRegistrationsScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const teamsQuery = useTeamsQuery();
  const team = teamsQuery.data?.find((t) => t.id === id);
  const effectiveTier = useEffectivePlanTier(id);
  // Free plans share one pool of players across evaluations and teams.
  const accountPlayers = useAccountPlayerCount(effectiveTier === 'free');
  const rosterIds = useTeamRosterAthleteIdsQuery(id);
  // Poll only while this screen is on show.
  const isFocused = useIsFocused();
  const regsQuery = useTeamRegistrationsQuery(id, { poll: isFocused });
  const ensureLink = useEnsureTeamRegistrationLinkMutation();
  const setOpen = useSetTeamRegistrationOpenMutation();
  const dismissReg = useDismissTeamRegistrationMutation(id);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const addRegs = useAddTeamRegistrationsMutation(id, (done, total) => setProgress({ done, total }));

  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showQr, setShowQr] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  // The link is created the first time a coach opens this screen, so there is
  // always something to share. A team that already has one just reuses it.
  const code = team?.registrationCode;
  useEffect(() => {
    if (team && !code && !ensureLink.isPending && !ensureLink.isError) ensureLink.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, code]);

  const all = useMemo(() => regsQuery.data ?? [], [regsQuery.data]);
  const filtered = useMemo(() => {
    if (tab === 'all') return all;
    if (tab === 'dismissed') return all.filter((r) => r.status === 'dismissed');
    return all.filter((r) => r.status === 'pending');
  }, [all, tab]);
  const viewing = useMemo(() => all.find((r) => r.id === viewingId) ?? null, [all, viewingId]);

  if (teamsQuery.isLoading) return <LoadingState message="Loading registrations..." />;
  if (teamsQuery.isError || !team) {
    return <ErrorState message="Could not load the team." onRetry={() => teamsQuery.refetch()} />;
  }

  const baseUrl = EXPO_PUBLIC_WEB_URL || 'https://www.tryouthq.ca';
  const registrationUrl = code ? `${baseUrl}/register/${code}` : '';
  const isOpen = team.registrationOpen ?? false;
  const pendingIds = all.filter((r) => r.status === 'pending').map((r) => r.id);
  const pendingIdSet = new Set(pendingIds);
  // Only the ticked registrations that are still pending count: one dismissed
  // or placed after being ticked stays in `selected` and would be sent anyway.
  const selectedIds = [...selected].filter((rid) => pendingIdSet.has(rid));
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((rid) => selected.has(rid));

  const toggleSelect = (rid: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });

  // Opens the phone's share sheet, so the coach can send the link by email,
  // text or any other app.
  const shareLink = async () => {
    if (!registrationUrl) return;
    await Share.share({
      message: `Register your player for ${team.name}: ${registrationUrl}`,
    });
  };

  const toggleOpen = async () => {
    try {
      await setOpen.mutateAsync({ teamId: id, open: !isOpen });
    } catch (e: any) {
      showAlert('Error', e?.message || 'Could not change the registration link.');
    }
  };

  const addToTeam = async (ids: string[]) => {
    if (ids.length === 0) return;
    // The player limit is measured against this team's roster; on the Free plan
    // evaluations and teams share one pool, so the account total counts too.
    const existing = rosterIds.data?.length ?? 0;
    if (isAtPlayerLimit(effectiveTier, playersTowardCap(effectiveTier, existing, accountPlayers) + ids.length - 1)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    try {
      setProgress({ done: 0, total: ids.length });
      await addRegs.mutateAsync(ids);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rid of ids) next.delete(rid);
        return next;
      });
    } catch (e: any) {
      showAlert('Error', e?.message || 'Could not add the players.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <Screen padded={false}>
      <Header title={team.name} subtitle="Registrations" showBack />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View className="pb-2 pt-2 gap-3">
            <PlanGate feature="qrRegistration" title="Registration link" tierOverride={effectiveTier}>
              <Card accent className="items-center gap-3">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Registration Code
                </Text>
                <Text className="text-3xl font-display font-bold tracking-widest" style={{ color: colors.primary }}>
                  {code ?? '------'}
                </Text>
                <Text className="text-center text-sm" style={{ color: colors.inkMuted }}>
                  Send this link to families so they can register a player for {team.name}.
                </Text>
                {code ? (
                  <Badge
                    label={isOpen ? 'Accepting registrations' : 'Link turned off'}
                    variant={isOpen ? 'success' : 'warning'}
                  />
                ) : null}
                <View className="flex-row flex-wrap gap-2 justify-center">
                  <Button label="Send Link" size="sm" disabled={!code || !isOpen} onPress={shareLink} />
                  <Button label="Show QR" size="sm" variant="secondary" disabled={!code} onPress={() => setShowQr(true)} />
                  <Button
                    label={isOpen ? 'Turn Off' : 'Turn On'}
                    size="sm"
                    variant="ghost"
                    disabled={!code}
                    loading={setOpen.isPending}
                    onPress={toggleOpen}
                  />
                </View>
              </Card>
            </PlanGate>

            {ensureLink.isError ? (
              <ErrorState message="Could not create the registration link." onRetry={() => ensureLink.mutate(id)} />
            ) : null}

            <Tabs
              tabs={[
                { key: 'pending', label: 'Pending', badge: pendingIds.length || undefined },
                { key: 'all', label: 'All' },
                { key: 'dismissed', label: 'Dismissed' },
              ]}
              activeKey={tab}
              onChange={(k) => setTab(k as RegTab)}
            />

            {tab === 'pending' && pendingIds.length > 0 ? (
              <View className="flex-row flex-wrap items-center gap-2">
                <Button
                  label={allPendingSelected ? 'Clear All' : 'Select All'}
                  size="sm"
                  variant="secondary"
                  onPress={() => setSelected(allPendingSelected ? new Set() : new Set(pendingIds))}
                />
                {selectedIds.length > 0 ? (
                  <Button
                    label={`Add ${selectedIds.length} to Team`}
                    size="sm"
                    loading={addRegs.isPending}
                    onPress={() => addToTeam(selectedIds)}
                  />
                ) : null}
              </View>
            ) : null}

            {progress ? (
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Adding {progress.done} of {progress.total}...
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          regsQuery.isLoading ? (
            <LoadingState message="Loading registrations..." />
          ) : regsQuery.isError ? (
            <ErrorState message="Could not load registrations." onRetry={() => regsQuery.refetch()} />
          ) : (
            <EmptyState
              title={`No ${tab} registrations`}
              message="Share the link or QR code with families so they can register."
            />
          )
        }
        renderItem={({ item }) => {
          const pending = item.status === 'pending';
          const isSelected = pending && selected.has(item.id);
          return (
            <Card className="mb-3 gap-3" accent={isSelected}>
              <View className="flex-row items-start gap-3">
                {/* The tick is its own big tap target, so picking a player never
                    opens the profile and opening the profile never picks. */}
                {pending ? (
                  <Pressable
                    onPress={() => toggleSelect(item.id)}
                    hitSlop={10}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={`Select ${item.firstName} ${item.lastName}`}
                    style={{
                      width: 28,
                      height: 28,
                      marginTop: 2,
                      borderRadius: 8,
                      borderWidth: 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected ? colors.primary : 'transparent',
                    }}
                  >
                    {isSelected ? <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>✓</Text> : null}
                  </Pressable>
                ) : null}

                <Pressable className="flex-1 gap-1" onPress={() => setViewingId(item.id)}>
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 text-xl font-bold" numberOfLines={1} style={{ color: colors.ink }}>
                      {item.firstName} {item.lastName}
                    </Text>
                    <Badge
                      label={item.status}
                      variant={pending ? 'warning' : item.status === 'added' ? 'success' : 'info'}
                    />
                  </View>
                  <Text className="text-base" numberOfLines={1} style={{ color: colors.inkMuted }}>
                    {item.guardianName}
                  </Text>
                  <Text className="text-sm" numberOfLines={1} style={{ color: colors.inkFaint }}>
                    {item.guardianEmail}
                  </Text>
                </Pressable>
              </View>

              {pending ? (
                <View className="flex-row items-center gap-2">
                  {selectedIds.length === 0 ? (
                    <View className="flex-1">
                      <Button
                        label="Add to Team"
                        loading={addRegs.isPending && addRegs.variables?.[0] === item.id}
                        onPress={() => addToTeam([item.id])}
                      />
                    </View>
                  ) : (
                    <View className="flex-1" />
                  )}
                  <Button label="Dismiss" variant="ghost" onPress={() => dismissReg.mutate(item.id)} />
                </View>
              ) : null}
            </Card>
          );
        }}
      />

      {/* Outside the list, so the group action stays on screen however far down
          the coach has scrolled while ticking players. */}
      {tab === 'pending' && selectedIds.length > 0 ? (
        <View
          className="flex-row items-center gap-3 border-t px-4 pt-4"
          // This screen has no bottom safe-area edge, and on Android the 3-button
          // bar draws over the last 48dp, hiding the Add button.
          style={{ borderColor: colors.border, backgroundColor: colors.card, paddingBottom: 16 + insets.bottom }}
        >
          <View className="flex-1">
            <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
              {selectedIds.length} selected
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              of {pendingIds.length} pending
            </Text>
          </View>
          <Button label="Clear" variant="ghost" onPress={() => setSelected(new Set())} />
          <Button label={`Add ${selectedIds.length}`} loading={addRegs.isPending} onPress={() => addToTeam(selectedIds)} />
        </View>
      ) : null}

      <Modal visible={showQr} title="Registration QR" onClose={() => setShowQr(false)}>
        <View className="items-center py-6 gap-4">
          <QRCode value={registrationUrl || ' '} size={220} backgroundColor="white" />
          <Text className="text-center text-sm" style={{ color: colors.inkMuted }}>
            Scan to register for {team.name}
          </Text>
          {code ? <Badge label={code} variant="brand" /> : null}
        </View>
      </Modal>

      <RegistrationProfileModal
        addLabel="Add to Team"
        registration={viewing}
        onClose={() => setViewingId(null)}
        onAddToRoster={() => {
          if (!viewing || viewing.status !== 'pending') return;
          setViewingId(null);
          void addToTeam([viewing.id]);
        }}
        onDismiss={() => {
          if (!viewing || viewing.status !== 'pending') return;
          dismissReg.mutate(viewing.id);
          setViewingId(null);
        }}
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
