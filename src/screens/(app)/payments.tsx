import { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Modal, Screen } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useEnterprisePaymentsQuery } from '@/features/queries';
import { useConnectStatus } from '@/features/useConnectStatus';
import { queryKeys } from '@/lib/queryClient';
import { getDataSource } from '@/data';
import { exportCsvFile } from '@/lib/exportCsv';
import { useUser, useAuthStore } from '@/state/authStore';
import { isTierAtLeast } from '@/data/plans';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Stripe's Canada (CAD) fee schedule, separate from SquadOwl's own 0.5%
// platform fee. Verified June 2026 — re-check against Stripe's published
// rates before updating any of these numbers.
const FEE_SCHEDULE: { type: string; fee: string; note: string }[] = [
  {
    type: 'Domestic card (CAD)',
    fee: '2.9% + CAD$0.30',
    note: 'Standard Canadian card, most common transaction.',
  },
  {
    type: 'International card',
    fee: '2.9% + CAD$0.30 + 0.8%',
    note: 'Card issued outside Canada, total ~3.7% + CAD$0.30.',
  },
  {
    type: 'Currency conversion',
    fee: '+ 2.0% additional',
    note: 'When payment currency differs from payout currency.',
  },
  {
    type: 'Stripe Billing (subscriptions)',
    fee: '+ 0.7% additional',
    note: "Applied when using Stripe's subscription billing system.",
  },
  {
    type: 'Chargeback / dispute',
    fee: 'CAD$15 flat fee',
    note: 'Charged whether you win or lose the dispute.',
  },
  {
    type: 'Stripe Connect (platform fee)',
    fee: '0.25% + CAD$0.25',
    note: "Required for collecting the 0.5% SquadOwl platform fee.",
  },
];

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
  const connect = useConnectStatus();
  const [exporting, setExporting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showFeeDetails, setShowFeeDetails] = useState(false);
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
      const assessmentKey = p.assessmentName || 'Unknown Event';
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
        (p) =>
          `${p.playerName},${p.teamName},${p.assessmentName || 'Unknown Event'},${p.amount.toFixed(2)},${p.status}`,
      );
      const csv = `player,team,evaluation,amount,status\n${csvRows.join('\n')}`;
      await exportCsvFile('payments.csv', csv);
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
      // finishes, so poll a few times instead of assuming it's instant. The
      // connect-status refetch is what actually settles this — it reads Stripe
      // directly and heals the cached column — so the loop waits on that rather
      // than on the profile flag, which never moves at all when the Connect
      // webhook is misconfigured.
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { data: live } = await connect.refetch();
        await restoreSession(true);
        await qc.invalidateQueries({ queryKey: queryKeys.profile });
        const current = useAuthStore.getState().session?.user;
        if (live?.chargesEnabled || current?.connectChargesEnabled) break;
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
          {!connect.chargesEnabled ? (
            <Card accent className="mb-4 gap-2">
              <Text className="font-display font-bold" style={{ color: colors.ink }}>
                Connect Payouts
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                Connect a Stripe account to start collecting registration fees. Stripe's
                processing fee (2.9% + $0.30 CAD) and SquadOwl's 0.5% platform fee are deducted
                automatically, the rest is paid out straight to you.
              </Text>
              {/* An account that exists but can't take charges is mid-onboarding
                  (or blocked on info Stripe still wants), say so, rather than
                  implying nothing was ever connected. */}
              {connect.onboardingIncomplete ? (
                <Text className="text-xs" style={{ color: colors.warning }}>
                  Your Stripe account isn't finished, Stripe still needs more information before it
                  will accept charges. Continue where you left off below.
                </Text>
              ) : null}
              <Button
                label={connect.onboardingIncomplete ? 'Continue Stripe Setup' : 'Connect with Stripe'}
                loading={connecting}
                onPress={connectPayouts}
              />
              <Button label="View Fee Details" variant="ghost" size="sm" onPress={() => setShowFeeDetails(true)} />
            </Card>
          ) : (
            <Card className="mb-4 gap-2">
              <View className="flex-row items-center gap-2">
                <Badge label="Payouts connected" variant="success" />
                <Button label="Fee Details" variant="ghost" size="sm" onPress={() => setShowFeeDetails(true)} />
              </View>
              {connect.isLoading ? (
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  Loading connected account…
                </Text>
              ) : connect.status?.connected ? (
                <>
                  <Text className="text-sm font-bold" style={{ color: colors.ink }}>
                    {connect.status.businessName ||
                      connect.status.email ||
                      connect.status.accountId}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Stripe account {connect.status.accountId}
                    {connect.status.country ? ` · ${connect.status.country}` : ''} ·{' '}
                    {(connect.status.platformFeeRate * 100).toFixed(1)}% SquadOwl fee + Stripe's
                    processing fee per transaction
                  </Text>
                </>
              ) : (
                <Text className="text-xs" style={{ color: colors.warning }}>
                  Couldn't load connected account details.
                </Text>
              )}
            </Card>
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
                By Evaluation
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
                    {[item.teamName, item.assessmentName].filter(Boolean).join(' · ')}
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

      {/* No ScrollView here — Modal already scrolls its children. An unbounded
          one nested inside that collapses and clips the tail of the content. */}
      <Modal visible={showFeeDetails} title="Stripe & Platform Fees" onClose={() => setShowFeeDetails(false)}>
        <>
          <Text className="text-base mb-4" style={{ color: colors.inkMuted }}>
            These are Stripe's own processing fees (CAD), deducted automatically per transaction
            before funds reach your account, separate from SquadOwl's 0.5% platform fee. Verified
            June 2026.
          </Text>

          {FEE_SCHEDULE.map((row) => (
            <View key={row.type} className="mb-4 pb-4 border-b" style={{ borderColor: colors.border }}>
              {/* Fee sits under its label rather than beside it: at this text size
                  the longest amount ("2.9% + CAD$0.30 + 0.8%") no longer fits in a
                  side-by-side column on a narrow phone without wrapping mid-figure. */}
              <Text className="text-md font-bold" style={{ color: colors.ink }}>
                {row.type}
              </Text>
              <Text className="text-md font-bold mt-0.5" style={{ color: colors.primary }}>
                {row.fee}
              </Text>
              <Text className="text-base mt-1" style={{ color: colors.inkMuted }}>
                {row.note}
              </Text>
            </View>
          ))}

          <Text className="text-md font-bold mt-2 mb-3" style={{ color: colors.ink }}>
            Real example: CAD$100 registration fee
          </Text>
          <View className="gap-2 mb-3">
            <View className="flex-row justify-between gap-2">
              <Text className="text-base flex-1" style={{ color: colors.inkMuted }}>
                Stripe fee (2.9% + $0.30)
              </Text>
              <Text className="text-base" style={{ color: colors.ink }}>
                −$3.20
              </Text>
            </View>
            <View className="flex-row justify-between gap-2">
              <Text className="text-base flex-1" style={{ color: colors.inkMuted }}>
                SquadOwl platform fee (0.5%)
              </Text>
              <Text className="text-base" style={{ color: colors.ink }}>
                −$0.50
              </Text>
            </View>
            <View className="flex-row justify-between gap-2 mt-1">
              <Text className="text-md font-bold flex-1" style={{ color: colors.ink }}>
                Coach receives
              </Text>
              <Text className="text-md font-bold" style={{ color: colors.success }}>
                $96.30
              </Text>
            </View>
          </View>
          <Text className="text-base" style={{ color: colors.inkMuted }}>
            Stripe fees are paid by the coach (subscriber), not by SquadOwl.
          </Text>
        </>
      </Modal>
    </Screen>
  );
}
