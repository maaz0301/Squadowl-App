import { useEffect, useMemo, useState } from 'react';
import { FlatList, Share, Text, View, Platform, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { EXPO_PUBLIC_WEB_URL } from '@env';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, ErrorState, Header, Input, LoadingState, Screen, Modal, EmptyState, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import { useUser } from '@/state/authStore';
import {
  useTryoutQuery,
  useRegistrationsQuery,
  useEnsureCloudSessionMutation,
  useAddRegistrationToRosterMutation,
  useDismissRegistrationMutation,
  useSubmitRegistrationMutation,
  useGenerateTestDataMutation,
  useClearTestDataMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { RegistrationForm } from '@/components/assessment/RegistrationForm';
import { LimitReachedModal } from '@/components/LimitReachedModal';

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
  const genTest = useGenerateTestDataMutation(id!);
  const clearTest = useClearTestDataMutation(id!);
  const user = useUser();
  const [showQr, setShowQr] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [testCount, setTestCount] = useState('50');
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

  const bulkAdd = async () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', (tryoutQuery.data?.roster.length ?? 0) + selected.size - 1)) {
      setLimitMsg('You have reached the maximum number of players for your current plan.');
      return;
    }
    for (const regId of selected) {
      await addToRoster.mutateAsync(regId);
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

  const runGenerate = async () => {
    const n = Math.max(10, Math.min(250, parseInt(testCount, 10) || 50));
    try {
      const res = await genTest.mutateAsync(n);
      setShowTestGen(false);
      showAlert(
        'Test data added',
        `Generated ${res.players} players with ${res.evaluations} evaluations. Open Results to see rankings.`,
      );
    } catch (e: any) {
      showAlert('Error', e?.message === 'NO_RUBRICS'
        ? 'Add at least one rubric before generating test players.'
        : e?.message || 'Failed to generate test data.');
    }
  };

  const clearTestData = async () => {
    try {
      const res = await clearTest.mutateAsync();
      showAlert('Cleared', `Removed ${res.removed} generated player${res.removed === 1 ? '' : 's'}.`);
    } catch (e: any) {
      showAlert('Error', e?.message || 'Failed to clear test data.');
    }
  };

  return (
    <Screen padded={false}>
      <Header title="Registrations" showBack />
      
      {/* Overview Stats */}
      <View className="px-4 pb-2 pt-2 flex-row gap-2">
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

        {tab === 'pending' && selected.size > 0 ? (
          <Button label={`Add ${selected.size} to Roster`} onPress={bulkAdd} loading={addToRoster.isPending} />
        ) : null}
        <Button label="Export CSV" variant="ghost" size="sm" onPress={exportCsv} />
      </View>

      {isAssociation ? (
        <Card className="mx-4 mb-2 gap-2">
          <Text className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Testing Tools
          </Text>
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            AI-generate a batch of realistic dummy players — varied names, positions, and ages —
            with scores across every rubric to test rankings, filters, and reports at scale.
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-1">
            <Button
              label="Generate Test Players"
              size="sm"
              onPress={() => setShowTestGen(true)}
            />
            <Button
              label="Clear Test Data"
              size="sm"
              variant="ghost"
              loading={clearTest.isPending}
              onPress={clearTestData}
            />
          </View>
        </Card>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
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

      <Modal visible={showTestGen} title="Generate Test Players" onClose={() => setShowTestGen(false)}>
        {!hasRubrics ? (
          <View className="gap-4 py-2">
            <Text className="text-sm" style={{ color: colors.ink }}>
              Test players are scored against this assessment's rubrics, but none are defined yet.
              Add at least one rubric — ideally covering skill, time, distance, and speed — then
              come back to generate players.
            </Text>
            <Button
              label="Add Rubrics"
              onPress={() => {
                setShowTestGen(false);
                navigation.navigate('AssessmentRubrics');
              }}
            />
          </View>
        ) : (
          <View className="gap-4 py-2">
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              How many players to generate? Each gets a varied age, position, and realistic scores
              across every rubric. A few are left unscored to test filters.
            </Text>
            <Input
              label="Number of players (10–250)"
              value={testCount}
              onChangeText={setTestCount}
              keyboardType="number-pad"
              placeholder="50"
            />
            <Button
              label={`Generate ${Math.max(10, Math.min(250, parseInt(testCount, 10) || 50))} Players`}
              loading={genTest.isPending}
              onPress={runGenerate}
            />
          </View>
        )}
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </Screen>
  );
}
