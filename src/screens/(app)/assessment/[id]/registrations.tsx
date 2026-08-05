import { RegistrationForm } from '@/components/assessment/RegistrationForm';
import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { PlanGate } from '@/components/PlanGate';
import { Badge, Button, Card, EmptyState, ErrorState, Header, LoadingState, Modal, Screen, Tabs } from '@/components/ui';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import type { DummyDataOptions } from '@/data/testDataGenerator';
import {
  useAddRegistrationToRosterMutation,
  useClearTestDataMutation,
  useDismissRegistrationMutation,
  useEnsureCloudSessionMutation,
  useGenerateTestDataMutation,
  useRegistrationsQuery,
  useSubmitRegistrationMutation,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { EXPO_PUBLIC_WEB_URL } from '@env';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Platform, Share, Text, View } from 'react-native';
import RNFS from 'react-native-fs';
import QRCode from 'react-native-qrcode-svg';
import RNShare from 'react-native-share';

type RegTab = 'pending' | 'all' | 'dismissed';

export default function RegistrationsScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const regsQuery = useRegistrationsQuery(id!);
  const ensureCloud = useEnsureCloudSessionMutation();
  const addToRoster = useAddRegistrationToRosterMutation(id!);
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

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  useEffect(() => {
    if (id && tryoutQuery.data && !tryoutQuery.data.cloud?.id) {
      ensureCloud.mutate(id);
    }
  }, [id, tryoutQuery.data]);

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
  const baseUrl = EXPO_PUBLIC_WEB_URL || 'https://aas-tryout.app';
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

  // Fires in small concurrent batches instead of one request at a time — with
  // "Select All" this can be hundreds of registrations, and awaiting them
  // sequentially made bulk-add visibly crawl. Batched (not all-at-once) so a
  // huge selection doesn't fire hundreds of simultaneous requests at the backend.
  const BULK_ADD_BATCH_SIZE = 10;
  const bulkAdd = async () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', (tryoutQuery.data?.roster.length ?? 0) + selected.size - 1)) {
      setLimitMsg('You have reached the maximum number of players for your current plan.');
      return;
    }
    const ids = [...selected];
    for (let i = 0; i < ids.length; i += BULK_ADD_BATCH_SIZE) {
      const batch = ids.slice(i, i + BULK_ADD_BATCH_SIZE);
      await Promise.all(batch.map((regId) => addToRoster.mutateAsync(regId)));
    }
    setSelected(new Set());
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
      setShowTestGen(false);
      const parts = [
        res.registrations ? `${res.registrations} pending registrations` : null,
        res.players ? `${res.players} roster players` : null,
        res.evaluations ? `${res.evaluations} evaluations` : null,
      ].filter(Boolean);
      showAlert('Dummy data added', `Created ${parts.join(', ')}.`);
    } catch (e: any) {
      showAlert('Error', e?.message === 'NO_RUBRICS'
        ? 'Add at least one rubric before generating scored players.'
        : e?.message || 'Failed to generate dummy data.');
    } finally {
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
              <PlanGate feature="qrRegistration" title="QR Registration (Coach+)">
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
                    {selected.size > 0 ? (
                      <Button label={`Add ${selected.size} to Roster`} size="sm" onPress={bulkAdd} loading={addToRoster.isPending} />
                    ) : null}
                  </>
                ) : null}
                <Button label="Export CSV" variant="ghost" size="sm" onPress={exportCsv} />
              </View>
            </View>

            {isAssociation ? (
              <Card className="mb-2 gap-2">
                <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Testing Tools
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  AI-generate a batch of realistic dummy records — pending registrations, rostered
                  players, or both — optionally scored across every rubric, to test rankings, filters,
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
        renderItem={({ item }) => (
          <Card className="mb-3 gap-2">
            <View className="flex-row justify-between">
              <Text className="text-lg font-bold" style={{ color: colors.ink }}>
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
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {item.guardianName} · {item.guardianEmail}
            </Text>
            {item.status === 'pending' ? (
              <View className="flex-row flex-wrap gap-2 mt-2">
                <Button
                  label={selected.has(item.id) ? 'Selected' : 'Select'}
                  size="sm"
                  variant={selected.has(item.id) ? 'primary' : 'secondary'}
                  onPress={() => toggleSelect(item.id)}
                />
                <Button
                  label="Add to Roster"
                  size="sm"
                  loading={addToRoster.isPending}
                  onPress={() => {
                    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
                      setLimitMsg('You have reached the maximum number of players for your current plan.');
                      return;
                    }
                    addToRoster.mutate(item.id);
                  }}
                />
                <Button
                  label="Dismiss"
                  size="sm"
                  variant="ghost"
                  onPress={() => dismissReg.mutate(item.id)}
                />
              </View>
            ) : null}
          </Card>
        )}
      />

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

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
