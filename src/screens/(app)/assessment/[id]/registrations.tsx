import { useEffect, useMemo, useState } from 'react';
import { FlatList, Share, Text, View, Platform, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { EXPO_PUBLIC_WEB_URL } from '@env';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, ErrorState, Header, LoadingState, Screen, Modal, EmptyState, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { isAtPlayerLimit } from '@/data/plans';
import { useUser } from '@/state/authStore';
import {
  useTryoutQuery,
  useRegistrationsQuery,
  useEnsureCloudSessionMutation,
  useAddRegistrationToRosterMutation,
  useDismissRegistrationMutation,
  useSubmitRegistrationMutation,
} from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { RegistrationForm } from '@/components/assessment/RegistrationForm';

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
  const user = useUser();
  const [showQr, setShowQr] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      Alert.alert(
        'Player Limit Reached',
        'You have reached the maximum number of players for your current plan.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'View Plans', onPress: () => navigation.navigate('Upgrade') }
        ]
      );
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
                      Alert.alert(
                        'Player Limit Reached',
                        'You have reached the maximum number of players for your current plan.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'View Plans', onPress: () => navigation.navigate('Upgrade') }
                        ]
                      );
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
    </Screen>
  );
}
