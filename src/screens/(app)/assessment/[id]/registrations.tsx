import { useTerms } from '@/lib/terms';
import { AddToRosterModal, type RosterDestination } from '@/components/assessment/AddToRosterModal';
import { RegistrationForm } from '@/components/assessment/RegistrationForm';
import { RegistrationProfileModal } from '@/components/assessment/RegistrationProfileModal';
import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { PlanGate } from '@/components/PlanGate';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Modal, Screen, Tabs } from '@/components/ui';
import { isAtPlayerLimit, playerRoom } from '@/data/plans';
import { useCanUseDummyData } from '@/features/useCanUseDummyData';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import type { DummyDataOptions } from '@/data/testDataGenerator';
import {
  useAddRegistrationToRosterMutation,
  useAddRegistrationToTeamMutation,
  useClearTestDataMutation,
  useDismissRegistrationMutation,
  useEnsureCloudSessionMutation,
  useGenerateTestDataMutation,
  usePlaceRegistrationsMutation,
  useRegistrationsQuery,
  useSubmitRegistrationMutation,
  useTryoutQuery,
  useTryoutSummariesQuery,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useThemeColors } from '@/theme/ThemeProvider';
import { EXPO_PUBLIC_WEB_URL } from '@env';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Pressable, Share, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import QRCode from 'react-native-qrcode-svg';
import RNShare from 'react-native-share';

type RegTab = 'pending' | 'all' | 'dismissed';

export default function RegistrationsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const regsQuery = useRegistrationsQuery(id!);
  const ensureCloud = useEnsureCloudSessionMutation();
  // Only the destination's headcount is read below, so the light list is
  // enough — see useTryoutSummariesQuery.
  const allTryouts = useTryoutSummariesQuery();
  const dismissReg = useDismissRegistrationMutation(id!);
  const submitReg = useSubmitRegistrationMutation(id!);
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(id!, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(id!);
  const user = useUser();
  const [showQr, setShowQr] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  // Registration ids waiting on a destination choice. Non-null == picker open.
  const [placing, setPlacing] = useState<string[] | null>(null);
  const [placingProgress, setPlacingProgress] = useState<{ done: number; total: number } | null>(null);
  // One mutation for the whole selection, so `isPending` stays true for the
  // entire run — the old per-player mutations settled between batches and made
  // the progress bar flicker hidden/shown each time.
  const placeRegs = usePlaceRegistrationsMutation(id!, (done, total) =>
    setPlacingProgress({ done, total }),
  );
  // A single selected registration skips the chunked bulk path and goes
  // straight through the single-registration mutations below.
  const addToRoster = useAddRegistrationToRosterMutation(id!);
  const addToTeam = useAddRegistrationToTeamMutation(id!);
  // Registration whose submitted profile is open. Non-null == profile open.
  const [viewingId, setViewingId] = useState<string | null>(null);

  const showDummyTools = useCanUseDummyData(effectiveTier);

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  useEffect(() => {
    if (id && tryoutQuery.data && !tryoutQuery.data.cloud?.id) {
      ensureCloud.mutate(id);
    }
  }, [id, tryoutQuery.data]);

  // Resolved from the live list rather than held as a snapshot, so the status
  // and payment badges in the profile stay current while it's open.
  const viewing = useMemo(
    () => (regsQuery.data ?? []).find((r) => r.id === viewingId) ?? null,
    [regsQuery.data, viewingId],
  );

  const filtered = useMemo(() => {
    const all = regsQuery.data ?? [];
    if (tab === 'all') return all;
    if (tab === 'dismissed') return all.filter((r) => r.status === 'dismissed');
    return all.filter((r) => r.status === 'pending');
  }, [regsQuery.data, tab]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load registrations." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const cloudCode = tryout.cloud?.id ?? '------';
  const baseUrl = EXPO_PUBLIC_WEB_URL || 'https://www.tryouthq.ca';
  const registrationUrl = `${baseUrl}/register/${cloudCode}`;
  const pendingCount = (regsQuery.data ?? []).filter((r) => r.status === 'pending').length;

  const shareQr = async () => {
    await Share.share({
      message: `Register for ${tryout.name}: ${registrationUrl}\nEvent Code: ${cloudCode}`,
    });
  };

  const toggleSelect = (regId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(regId)) next.delete(regId);
      else next.add(regId);
      return next;
    });
  };

  const pendingIds = (regsQuery.data ?? []).filter((r) => r.status === 'pending').map((r) => r.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((regId) => selected.has(regId));
  const toggleSelectAll = () => {
    setSelected(allPendingSelected ? new Set() : new Set(pendingIds));
  };
  // What "Add N to Roster" actually places: the ticked registrations that are
  // still pending. A player dismissed (or placed elsewhere) after being ticked
  // stays in `selected`, and would otherwise be counted and sent anyway.
  const pendingIdSet = new Set(pendingIds);
  const selectedIds = [...selected].filter((regId) => pendingIdSet.has(regId));
  // The "Add to Roster" on a card means the whole ticked group when that card is
  // one of them — tapping it on one of several ticked players used to place only
  // that one, which is how a multi-select "sent one player".
  const addFromCard = (regId: string) => setPlacing(selected.has(regId) && selectedIds.length > 1 ? selectedIds : [regId]);

  const runPlacement = async (destination: RosterDestination) => {
    const ids = placing ?? [];
    if (ids.length === 0) return;

    // The player limit is per-assessment, so it has to be measured against the
    // roster actually receiving these players — not this screen's assessment,
    // which may not be the destination. A team roster isn't capped this way.
    if (destination.kind === 'assessment') {
      const target = (allTryouts.data ?? []).find((t) => t.id === destination.id);
      const existing = target?.playerCount ?? 0;
      if (isAtPlayerLimit(effectiveTier, existing + ids.length - 1)) {
        setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
        return;
      }
    }

    try {
      if (ids.length === 1) {
        // One player: go straight through the single-registration mutation
        // instead of the chunked bulk path — no progress bar needed.
        if (destination.kind === 'team') {
          await addToTeam.mutateAsync({ teamId: destination.id, registrationId: ids[0] });
        } else {
          await addToRoster.mutateAsync({ registrationId: ids[0], targetTryoutId: destination.id });
        }
      } else {
        setPlacingProgress({ done: 0, total: ids.length });
        // The whole selection goes down as one call — the data source places it in
        // chunks of 20, several in flight at once, and reports back as each chunk
        // lands, so the bar moves without the screen having to orchestrate
        // batching itself.
        await placeRegs.mutateAsync({ destination, registrationIds: ids });
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const regId of ids) next.delete(regId);
        return next;
      });
      setPlacing(null);
    } catch (e: any) {
      showAlert('Error', e?.message || terms.t('Failed to add players.'));
    } finally {
      setPlacingProgress(null);
    }
  };

  const exportCsv = async () => {
    const data = regsQuery.data ?? [];
    if (data.length === 0) return;

    const rows = data.map(
      (r) =>
        `${r.firstName},${r.lastName},${r.guardianEmail},${r.status},${r.paymentStatus ?? 'unpaid'}`,
    );
    const csv = `first,last,email,status,payment\n${rows.join('\n')}`;
    const filename = `${tryout?.name ?? 'registrations'}_regs.csv`.replace(/\s+/g, '_').toLowerCase();

    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const path = `${RNFS.CachesDirectoryPath}/${filename}`;
      await RNFS.writeFile(path, csv, 'utf8');
      try {
        await RNShare.open({
          url: `file://${path}`,
          type: 'text/csv',
          filename: filename,
          title: `Export ${filename}`
        });
      } catch (e: any) {
        if (e.message !== 'User did not share') {
          await Share.share({ message: csv, title: filename });
        }
      }
    }
  };

  const hasRubrics = (tryout.settings.customRubrics?.length ?? 0) > 0;

  const runGenerate = async (options: DummyDataOptions) => {
    setDummyProgress(null);
    try {
      const res = await genTest.mutateAsync(options);
      const parts = [
        res.registrations ? `${res.registrations} pending registrations` : null,
        res.players ? `${res.players} roster players` : null,
        res.evaluations ? `${res.evaluations} evaluations` : null,
      ].filter(Boolean);
      showAlert('Dummy data added', `Created ${parts.join(', ')}.`);
    } catch (e: any) {
      showAlert('Error', e?.message === 'NO_RUBRICS'
        ? terms.t('Add at least one rubric before generating scored players.')
        : e?.message || 'Failed to generate dummy data.');
    } finally {
      // In `finally`, not after the await: generateTestData writes
      // incrementally, so a partial run still created real rows and the modal
      // must not stay open over a stale form.
      setShowTestGen(false);
      setDummyProgress(null);
    }
  };

  const clearTestData = async () => {
    try {
      const res = await clearTest.mutateAsync();
      showAlert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to clear dummy data.');
    }
  };

  return (
    <Screen padded={false}>
      <Header title="Registrations" showBack />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            {/* Overview Stats */}
            <View className="pb-2 pt-2 gap-3">
              <PlanGate feature="qrRegistration" title="QR Registration">
                <Card accent className="items-center gap-3">
                  <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                    Registration Code
                  </Text>
                  <Text className="text-3xl font-display font-bold tracking-widest" style={{ color: colors.primary }}>
                    {cloudCode}
                  </Text>
                  <View className="flex-row flex-wrap gap-2 justify-center">
                    <Button label="Show QR" size="sm" onPress={() => setShowQr(true)} />
                    <Button label="Share" size="sm" variant="secondary" onPress={shareQr} />
                    <Button label="Simulate QR Reg" size="sm" variant="ghost" onPress={() => setShowSimulate(true)} />
                  </View>
                </Card>
              </PlanGate>

              <Tabs
                tabs={[
                  { key: 'pending', label: 'Pending', badge: pendingCount || undefined },
                  { key: 'all', label: 'All' },
                  { key: 'dismissed', label: 'Dismissed' },
                ]}
                activeKey={tab}
                onChange={(k) => setTab(k as RegTab)}
              />

              <View className="flex-row flex-wrap items-center gap-2">
                {tab === 'pending' && pendingIds.length > 0 ? (
                  <>
                    <Button
                      label={allPendingSelected ? 'Clear All' : 'Select All'}
                      size="sm"
                      variant="secondary"
                      onPress={toggleSelectAll}
                    />
                    {selectedIds.length > 0 ? (
                      <Button
                        label={`Add ${selectedIds.length} to Roster`}
                        size="sm"
                        onPress={() => setPlacing(selectedIds)}
                      />
                    ) : null}
                  </>
                ) : null}
                <Button label="Export CSV" variant="ghost" size="sm" onPress={exportCsv} />
              </View>
            </View>

            {showDummyTools ? (
              <Card className="mb-2 gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Testing Tools
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  AI-generate a batch of realistic dummy records, pending registrations, rostered
                  players, or both, optionally scored across every rubric, to test rankings, filters,
                  and reports at scale.
                </Text>
                <View className="flex-row flex-wrap gap-2 mt-1">
                  <Button
                    label="Dummy Data"
                    size="sm"
                    onPress={() => setShowTestGen(true)}
                  />
                  <Button
                    label="Clear Dummy Data"
                    size="sm"
                    variant="ghost"
                    loading={clearTest.isPending}
                    onPress={clearTestData}
                  />
                </View>
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title={`No ${tab} registrations`}
            message="Share the QR code with athletes and guardians to register."
          />
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
                    <View className="items-end gap-1">
                      <Badge
                        label={item.status}
                        variant={item.status === 'pending' ? 'warning' : item.status === 'added' ? 'success' : 'info'}
                      />
                      {item.paymentStatus ? (
                        <Badge
                          label={item.paymentStatus}
                          variant={item.paymentStatus === 'paid' ? 'success' : 'warning'}
                        />
                      ) : null}
                    </View>
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
                  {/* With a group ticked the bar below does the adding; repeating
                      "Add 9 to Roster" on every card only made them look alike. */}
                  {selectedIds.length === 0 ? (
                    <View className="flex-1">
                      <Button label="Add to Roster" onPress={() => addFromCard(item.id)} />
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
          className="flex-row items-center gap-3 border-t px-4 py-4"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
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
          <Button label={`Add ${selectedIds.length}`} onPress={() => setPlacing(selectedIds)} />
        </View>
      ) : null}

      <Modal visible={showQr} title="Registration QR" onClose={() => setShowQr(false)}>
        <View className="items-center py-6 gap-4">
          <QRCode value={registrationUrl} size={220} backgroundColor="white" />
          <Text className="text-center text-sm" style={{ color: colors.inkMuted }}>
            Scan to register for {tryout.name}
          </Text>
          <Badge label={cloudCode} variant="brand" />
        </View>
      </Modal>

      <Modal visible={showSimulate} title="Simulate Registration" onClose={() => setShowSimulate(false)}>
        <RegistrationForm
          loading={submitReg.isPending}
          onSubmit={async (data) => {
            await submitReg.mutateAsync(data);
            setShowSimulate(false);
          }}
        />
      </Modal>

      <DummyDataModal
        variant="assessment"
        maxPlayers={playerRoom(effectiveTier, tryout.roster.length)}
        visible={showTestGen}
        loading={genTest.isPending}
        progress={dummyProgress ?? undefined}
        hasRubrics={hasRubrics}
        onAddRubrics={() => {
          setShowTestGen(false);
          navigation.navigate('AssessmentRubrics');
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={runGenerate}
      />

      <RegistrationProfileModal
        labels={tryoutQuery.data?.settings.customLabels}
        registration={viewing}
        onClose={() => setViewingId(null)}
        onAddToRoster={() => {
          if (!viewing) return;
          setViewingId(null);
          setPlacing([viewing.id]);
        }}
        onDismiss={() => {
          if (!viewing) return;
          dismissReg.mutate(viewing.id);
          setViewingId(null);
        }}
      />

      <AddToRosterModal
        labels={tryoutQuery.data?.settings.customLabels}
        visible={placing !== null}
        count={placing?.length ?? 0}
        currentTryoutId={id}
        loading={
          (placing?.length ?? 0) === 1
            ? addToRoster.isPending || addToTeam.isPending
            : placeRegs.isPending
        }
        progress={placingProgress ?? undefined}
        onClose={() => setPlacing(null)}
        onConfirm={runPlacement}
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
