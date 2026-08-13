import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, ErrorState, Header, LoadingState, Screen, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useOrgQuery,
  useEnterprisePaymentsQuery,
  useOrgMembersQuery,
  useTryoutsQuery,
  useTeamsQuery,
  useSeasonsQuery,
} from '@/features/queries';
import type { Tryout } from '@/data/types';

const ENT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'actions', label: 'Actions' },
  { key: 'members', label: 'Members' },
] as const;

type EntTab = (typeof ENT_TABS)[number]['key'];

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Compact KPI tile, shared by the overview and financial summaries. */
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

/** Horizontal share bar — one proportional segment per non-zero slice. */
function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const colors = useThemeColors();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) {
    return (
      <Text className="text-xs" style={{ color: colors.inkMuted }}>
        No data yet.
      </Text>
    );
  }
  return (
    <View className="gap-2">
      <View className="flex-row h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />
          ))}
      </View>
      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => (
          <View key={p.label} className="flex-row items-center gap-1">
            <View className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {p.label} {p.value} ({Math.round((p.value / total) * 100)}%)
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function EnterpriseScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<EntTab>('overview');
  const orgQuery = useOrgQuery();
  const paymentsQuery = useEnterprisePaymentsQuery();
  const membersQuery = useOrgMembersQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();

  const tryouts = tryoutsQuery.data ?? [];

  /**
   * Every headline number here is derived from the assessments the org actually
   * owns, so the dashboard moves with the data instead of showing fixed sample
   * figures. All of it comes from queries the app already caches — no extra
   * round trips for this screen.
   */
  const metrics = useMemo(() => {
    let players = 0;
    let scoredPlayers = 0;
    let evaluations = 0;
    let regsTotal = 0;
    let regsPending = 0;
    let regsAdded = 0;
    let unpaid = 0;
    const recCounts: Record<string, number> = { Make: 0, Keep: 0, Bubble: 0, Release: 0 };
    const bySport: Record<string, number> = {};
    const needsAttention: { tryout: Tryout; unscored: number; pending: number }[] = [];

    for (const t of tryouts) {
      const roster = t.roster ?? [];
      const evals = t.evals ?? [];
      players += roster.length;
      evaluations += evals.length;
      bySport[t.sport] = (bySport[t.sport] ?? 0) + 1;

      const scoredIds = new Set(evals.map((e) => e.playerId));
      const unscored = roster.filter((p) => !scoredIds.has(p.id)).length;
      scoredPlayers += roster.length - unscored;

      for (const e of evals) {
        if (e.recommendation && recCounts[e.recommendation] !== undefined) {
          recCounts[e.recommendation]++;
        }
      }

      const regs = t.registrations ?? [];
      regsTotal += regs.length;
      const pending = regs.filter((r) => r.status === 'pending').length;
      regsPending += pending;
      regsAdded += regs.filter((r) => r.status === 'added').length;
      unpaid += regs.filter((r) => r.paymentStatus && r.paymentStatus !== 'paid').length;

      if (unscored > 0 || pending > 0) needsAttention.push({ tryout: t, unscored, pending });
    }

    needsAttention.sort((a, b) => b.unscored + b.pending - (a.unscored + a.pending));

    const largest = [...tryouts]
      .sort((a, b) => (b.roster?.length ?? 0) - (a.roster?.length ?? 0))
      .slice(0, 5);

    return {
      players,
      scoredPlayers,
      evaluations,
      regsTotal,
      regsPending,
      regsAdded,
      unpaid,
      recCounts,
      bySport,
      needsAttention,
      largest,
      scoredPct: players ? Math.round((scoredPlayers / players) * 100) : 0,
      convertedPct: regsTotal ? Math.round((regsAdded / regsTotal) * 100) : 0,
      avgSize: tryouts.length ? Math.round(players / tryouts.length) : 0,
      evalsPerPlayer: players ? (evaluations / players).toFixed(1) : '0',
    };
  }, [tryouts]);

  const finance = useMemo(() => {
    const rows = paymentsQuery.data ?? [];
    const sum = (status: string) =>
      rows.filter((p) => p.status === status).reduce((s, p) => s + (p.amount || 0), 0);
    return {
      rows,
      collected: sum('paid'),
      pending: sum('pending'),
      refunded: sum('refunded'),
      paidCount: rows.filter((p) => p.status === 'paid').length,
      pendingCount: rows.filter((p) => p.status === 'pending').length,
    };
  }, [paymentsQuery.data]);

  /**
   * The members directory deliberately folds in one entry per athlete guardian
   * (see listOrgMembers), so its length tracks roster size — a 130-player roster
   * reads as "130 members" even with nobody invited. The headline badge counts
   * only people holding a seat in the org: staff and assessors.
   */
  const staffCount = useMemo(
    () => membersQuery.data?.filter((m) => m.role !== 'guardian').length,
    [membersQuery.data],
  );

  if (orgQuery.isLoading) return <LoadingState message="Loading org..." />;

  const org = orgQuery.data;
  const unscoredPlayers = metrics.players - metrics.scoredPlayers;

  const openAssessment = (id: string) =>
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id } });

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Dashboard" showBack />
        <PlanGate feature="enterprise" title="Enterprise Dashboard">
          <Tabs tabs={[...ENT_TABS]} activeKey={tab} onChange={(k) => setTab(k as EntTab)} className="mb-4" />
        </PlanGate>
      </View>

      {tab === 'overview' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {org ? (
            <Card accent className="mb-4 gap-2">
              <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
                {org.orgName}
              </Text>
              {org.orgSlug ? (
                <Text style={{ color: colors.inkMuted }}>/{org.orgSlug}</Text>
              ) : null}
              <View className="flex-row flex-wrap gap-2 mt-2">
                <Badge label={`${staffCount ?? org.memberCount} staff`} />
                <Badge label={`${tryouts.length} assessments`} variant="brand" />
                <Badge label={`${metrics.players} players`} variant="info" />
              </View>
            </Card>
          ) : orgQuery.isError ? (
            // Only a real fetch failure is an error — an account with nothing in
            // it yet still renders its (zeroed) metrics below.
            <ErrorState message="Could not load your organization." onRetry={() => orgQuery.refetch()} />
          ) : null}

          {tryoutsQuery.isLoading ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Loading org metrics...
            </Text>
          ) : (
            <>
              <View className="flex-row flex-wrap gap-2 mb-4">
                <Stat label="Players" value={`${metrics.players}`} hint={`${metrics.avgSize} avg / assessment`} />
                <Stat label="Evaluations" value={`${metrics.evaluations}`} hint={`${metrics.evalsPerPlayer} per player`} />
                <Stat
                  label="Scored"
                  value={`${metrics.scoredPct}%`}
                  hint={`${unscoredPlayers} unscored`}
                  tone={
                    metrics.scoredPct >= 75
                      ? colors.success
                      : metrics.scoredPct >= 40
                        ? colors.warning
                        : colors.danger
                  }
                />
                <Stat label="Teams" value={`${teamsQuery.data?.length ?? 0}`} />
                <Stat label="Seasons" value={`${seasonsQuery.data?.length ?? 0}`} />
                <Stat label="Registrations" value={`${metrics.regsTotal}`} hint={`${metrics.regsPending} pending`} />
              </View>

              <Card className="mb-4 gap-3">
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  Scoring Progress
                </Text>
                <ShareBar
                  parts={[
                    { label: 'Scored', value: metrics.scoredPlayers, color: colors.success },
                    { label: 'Unscored', value: unscoredPlayers, color: colors.border },
                  ]}
                />
              </Card>

              <Card className="mb-4 gap-3">
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  Recommendation Mix
                </Text>
                <ShareBar
                  parts={[
                    { label: 'Make', value: metrics.recCounts.Make, color: colors.success },
                    { label: 'Keep', value: metrics.recCounts.Keep, color: colors.primary },
                    { label: 'Bubble', value: metrics.recCounts.Bubble, color: colors.warning },
                    { label: 'Release', value: metrics.recCounts.Release, color: colors.danger },
                  ]}
                />
              </Card>

              <Card className="mb-4 gap-3">
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  Registration Funnel
                </Text>
                <ShareBar
                  parts={[
                    { label: 'Added', value: metrics.regsAdded, color: colors.success },
                    { label: 'Pending', value: metrics.regsPending, color: colors.warning },
                    {
                      label: 'Dismissed',
                      value: Math.max(0, metrics.regsTotal - metrics.regsAdded - metrics.regsPending),
                      color: colors.border,
                    },
                  ]}
                />
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {metrics.convertedPct}% of registrations converted to roster players.
                </Text>
              </Card>

              {Object.keys(metrics.bySport).length > 0 ? (
                <Card className="mb-4 gap-2">
                  <Text className="font-display font-bold" style={{ color: colors.ink }}>
                    Assessments by Sport
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {Object.entries(metrics.bySport)
                      .sort((a, b) => b[1] - a[1])
                      .map(([sport, count]) => (
                        <Badge key={sport} label={`${sport} · ${count}`} />
                      ))}
                  </View>
                </Card>
              ) : null}

              {metrics.largest.length > 0 ? (
                <Card className="gap-2">
                  <Text className="font-display font-bold" style={{ color: colors.ink }}>
                    Largest Assessments
                  </Text>
                  {metrics.largest.map((t) => (
                    <Pressable key={t.id} onPress={() => openAssessment(t.id)} className="py-2">
                      <View className="flex-row justify-between items-center">
                        <View className="flex-1 pr-2">
                          <Text className="font-bold" style={{ color: colors.ink }}>
                            {t.name}
                          </Text>
                          <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                            {t.sport} · {t.evals?.length ?? 0} evaluations
                          </Text>
                        </View>
                        <Badge label={`${t.roster?.length ?? 0}`} variant="brand" />
                      </View>
                    </Pressable>
                  ))}
                </Card>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : null}



      {tab === 'actions' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <View className="flex-row flex-wrap gap-2 mb-4">
            <Stat
              label="Pending regs"
              value={`${metrics.regsPending}`}
              hint="awaiting review"
              tone={metrics.regsPending ? colors.warning : colors.ink}
            />
            <Stat
              label="Unscored"
              value={`${unscoredPlayers}`}
              hint="players with no eval"
              tone={unscoredPlayers ? colors.warning : colors.ink}
            />
            <Stat
              label="Unpaid"
              value={`${metrics.unpaid}`}
              hint="registrations"
              tone={metrics.unpaid ? colors.danger : colors.ink}
            />
          </View>

          <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
            Needs Attention
          </Text>
          {metrics.needsAttention.length === 0 ? (
            <Card className="gap-1">
              <Text className="font-bold" style={{ color: colors.success }}>
                All clear
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                Every assessment is fully scored with no pending registrations.
              </Text>
            </Card>
          ) : (
            metrics.needsAttention.map(({ tryout: t, unscored, pending }) => (
              <Pressable key={t.id} onPress={() => openAssessment(t.id)}>
                <Card className="mb-2 gap-2">
                  <Text className="font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {pending > 0 ? <Badge label={`${pending} pending regs`} variant="warning" /> : null}
                    {unscored > 0 ? <Badge label={`${unscored} unscored`} variant="info" /> : null}
                  </View>
                </Card>
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : null}

      {tab === 'members' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {membersQuery.isLoading ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Loading members...
            </Text>
          ) : (membersQuery.data?.length ?? 0) === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No members yet — invite staff from Organization Members.
            </Text>
          ) : (
            <>
              <View className="flex-row flex-wrap gap-2 mb-4">
                {(['admin', 'coach', 'assessor', 'guardian'] as const).map((role) => {
                  const count = (membersQuery.data ?? []).filter((m) => m.role === role).length;
                  return count > 0 ? <Badge key={role} label={`${role} · ${count}`} /> : null;
                })}
              </View>
              {(membersQuery.data ?? []).map((m) => (
                <Card key={m.id} className="mb-2 flex-row justify-between items-center">
                  <View className="flex-1 pr-2">
                    <Text className="font-bold" style={{ color: colors.ink }}>
                      {m.name || m.email}
                    </Text>
                    <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                      {m.email}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <Badge label={m.role} variant="brand" />
                    <Badge
                      label={m.status}
                      variant={m.status === 'active' ? 'success' : m.status === 'pending' ? 'warning' : 'default'}
                    />
                  </View>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
