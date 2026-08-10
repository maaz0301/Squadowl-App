import { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Share, Text, View } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Screen } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useEnterprisePaymentsQuery } from '@/features/queries';
import { queryKeys } from '@/lib/queryClient';
import { getDataSource } from '@/data';
import { useUser, useAuthStore } from '@/state/authStore';
import { isTierAtLeast } from '@/data/plans';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  const colors = useThemeColors();
  return (
    <Card className="flex-1 min-w-[104px] gap-1 p-3">
      <Text className="text-2xl font-display font-bold" style={{ color: tone ?? colors.ink }}>
        {value}
      </Text>
      <Text className="text-xs font-bold" style={{ color: colors.ink }}>
        {label}
      </Text>
      {hint ? (
        <Text className="text-[10px]" style={{ color: colors.inkMuted }}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export default function PaymentsScreen() {
  const colors = useThemeColors();
  const user = useUser();
  const tier = user?.planTier ?? 'free';
  const paymentsQuery = useEnterprisePaymentsQuery();
  const [exporting, setExporting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const qc = useQueryClient();
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Coach gets the basic ledger + totals. Coach+ and Club also get per-player /
  // per-assessment breakdowns and CSV export.
  const enhanced = isTierAtLeast(tier, 'coach_plus');

  const finance = useMemo(() => {
    const rows = paymentsQuery.data ?? [];
    const sum = (status: string) =>
      rows.filter((p) => p.status === status).reduce((s, p) => s + (p.amount || 0), 0);

    const byPlayer = new Map<string, number>();
    const byAssessment = new Map<string, number>();
    for (const p of rows) {
      if (p.status !== 'paid') continue;
      byPlayer.set(p.playerName, (byPlayer.get(p.playerName) ?? 0) + p.amount);
      const assessmentKey = p.assessmentName || 'Subscription';
      byAssessment.set(assessmentKey, (byAssessment.get(assessmentKey) ?? 0) + p.amount);
    }

    return {
      rows,
      collected: sum('paid'),
      pending: sum('pending'),
      refunded: sum('refunded'),
      paidCount: rows.filter((p) => p.status === 'paid').length,
      pendingCount: rows.filter((p) => p.status === 'pending').length,
      byPlayer: [...byPlayer.entries()].sort((a, b) => b[1] - a[1]),
      byAssessment: [...byAssessment.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [paymentsQuery.data]);

  const exportCsv = async () => {
    const rows = finance.rows;
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const csvRows = rows.map(
        (p) => `${p.playerName},${p.assessmentName || 'Subscription'},${p.amount.toFixed(2)},${p.status}`,
      );
      const csv = `player,assessment,amount,status\n${csvRows.join('\n')}`;
      const filename = 'payments.csv';

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
            filename,
            title: `Export ${filename}`,
          });
        } catch (e: any) {
          if (e.message !== 'User did not share') {
            await Share.share({ message: csv, title: filename });
          }
        }
      }
    } finally {
      setExporting(false);
    }
  };

  const connectPayouts = async () => {
    try {
      setConnecting(true);
      const res = await getDataSource().createConnectAccountLink();
      if (!res?.url) return;

      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.openAuth(res.url, 'aastryout://payments', {
          dismissButtonStyle: 'cancel',
          preferredBarTintColor: colors.bg,
          preferredControlTintColor: colors.primary,
          modalPresentationStyle: 'fullScreen',
        });
      } else {
        const { Linking } = require('react-native');
        await Linking.openURL(res.url);
      }

      // Stripe's account.updated webhook lands a moment after onboarding
      // finishes, so poll a few times instead of assuming it's instant.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (current?.connectChargesEnabled) break;
      }
    } catch (err: any) {
      Alert.alert('Connect Error', err.message || 'Something went wrong.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Payments" showBack />
      </View>
      <PlanGate feature="payments" title="Payment Dashboard">
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {!user?.connectChargesEnabled ? (
            <Card accent className="mb-4 gap-2">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                Connect Payouts
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Connect a Stripe account to start collecting registration fees. Stripe's
                processing fee (2.9% + $0.30 CAD) and TryoutHQ's 0.5% platform fee are deducted
                automatically — the rest is paid out straight to you.
              </Text>
              <Button label="Connect with Stripe" loading={connecting} onPress={connectPayouts} />
            </Card>
          ) : (
            <Badge label="Payouts connected" variant="success" className="mb-4 self-start" />
          )}

          <View className="flex-row flex-wrap gap-2 mb-4">
            <Stat
              label="Collected"
              value={money(finance.collected)}
              hint={`${finance.paidCount} payments`}
              tone={colors.success}
            />
            <Stat
              label="Pending"
              value={money(finance.pending)}
              hint={`${finance.pendingCount} outstanding`}
              tone={colors.warning}
            />
            <Stat label="Refunded" value={money(finance.refunded)} tone={colors.danger} />
          </View>

          {enhanced ? (
            <>
              <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
                By Player
              </Text>
              {finance.byPlayer.length === 0 ? (
                <Text className="text-sm mb-4" style={{ color: colors.inkMuted }}>
                  No paid payments yet.
                </Text>
              ) : (
                finance.byPlayer.map(([name, amount]) => (
                  <Card key={name} className="mb-2 flex-row justify-between">
                    <Text style={{ color: colors.ink }}>{name}</Text>
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {money(amount)}
                    </Text>
                  </Card>
                ))
              )}

              <Text className="text-md font-display font-bold mb-3 mt-2" style={{ color: colors.ink }}>
                By Assessment
              </Text>
              {finance.byAssessment.length === 0 ? (
                <Text className="text-sm mb-4" style={{ color: colors.inkMuted }}>
                  No paid payments yet.
                </Text>
              ) : (
                finance.byAssessment.map(([name, amount]) => (
                  <Card key={name} className="mb-2 flex-row justify-between">
                    <Text style={{ color: colors.ink }}>{name}</Text>
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {money(amount)}
                    </Text>
                  </Card>
                ))
              )}

              <Button
                label="Export CSV"
                variant="secondary"
                className="mb-4"
                loading={exporting}
                onPress={exportCsv}
              />
            </>
          ) : null}

          <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
            Payment Ledger
          </Text>
          {finance.rows.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No payments recorded yet.
            </Text>
          ) : (
            finance.rows.map((item) => (
              <Card key={item.id} className="mb-2 flex-row justify-between items-center">
                <View className="flex-1 pr-2">
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {item.playerName}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {item.assessmentName || 'Subscription'}
                  </Text>
                </View>
                <View className="items-end gap-1">
                  <Text className="font-display font-bold" style={{ color: colors.ink }}>
                    {money(item.amount)}
                  </Text>
                  <Badge
                    label={item.status}
                    variant={item.status === 'paid' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}
                  />
                </View>
              </Card>
            ))
          )}
        </ScrollView>
      </PlanGate>
    </Screen>
  );
}
