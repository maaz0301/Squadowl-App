import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Modal, Screen, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { FeatureBlockGate } from '@/components/FeatureBlockGate';
import {
  useOrgQuery,
  useEnterprisePaymentsQuery,
  useOrgMembersQuery,
  useRemoveMemberMutation,
  useTryoutsQuery,
  useTeamsQuery,
  useSeasonsQuery,
  usePrefetchTryout,
  useArchiveTryoutMutation,
  useDeleteTryoutMutation,
  usePlatformBlockedFeaturesQuery,
} from '@/features/queries';
import type { OrgMember, Tryout } from '@/data/types';
import { usePermissions } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
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
  const { canManageOrganization } = usePermissions();
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const setAssessorOnlyTryout = useSessionStore((s) => s.setAssessorOnlyTryout);
  const [tab, setTab] = useState<EntTab>('overview');
  const orgQuery = useOrgQuery();
  const prefetchTryout = usePrefetchTryout();
  const paymentsQuery = useEnterprisePaymentsQuery();
  // Staff + assessors only — guardians come off every athlete and dominate
  // large orgs. Load only when the Members tab is open so overview stays light.
  // Permissions already warms the same staff-only cache.
  const membersQuery = useOrgMembersQuery({
    includeGuardians: false,
    enabled: tab === 'members',
  });
  const removeMut = useRemoveMemberMutation();
  const tryoutsQuery = useTryoutsQuery(false, tab === 'overview' || tab === 'actions');
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();
  const archiveTryout = useArchiveTryoutMutation();
  const deleteTryout = useDeleteTryoutMutation();
  // Same action modal as the main dashboard's evaluation cards — Largest
  // Evaluations is a report, but the rows are the same tryouts, so removing
  // one here should behave identically rather than inventing a second
  // "remove an evaluation" flow.
  const [actionTryout, setActionTryout] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tryouts = tryoutsQuery.data ?? [];

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  /**
   * Same removal path as Manage Organization — assessors are tryout_assessors
   * rows (often several per person), coaches are memberships. Confirm first.
   */
  const handleRemoveMember = (member: OrgMember) => {
    const who = member.name || member.email;
    const isAssessor = member.role === 'assessor' || member.source === 'assessor';
    const isGuardian = member.role === 'guardian';
    const title = isAssessor ? 'Remove Assessor' : isGuardian ? 'Revoke Access' : 'Remove Member';
    const message = isAssessor
      ? `Remove ${who} as an assessor? They will lose access to every evaluation they were invited to score in this organization.`
      : isGuardian
        ? `Revoke ${who}'s access to this organization? They will no longer see their players here.`
        : `Remove ${who} from this organization? They will lose access to its teams and evaluations.`;

    const remove = async () => {
      try {
        await removeMut.mutateAsync(member.id);
      } catch (error: any) {
        showAlert(
          isAssessor ? 'Remove Assessor Failed' : isGuardian ? 'Revoke Failed' : 'Remove Failed',
          error?.message || 'Could not remove this member.',
        );
      }
    };

    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm?.(`${title}\n\n${message}`)) void remove();
      return;
    }

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: isAssessor ? 'Remove Assessor' : isGuardian ? 'Revoke' : 'Remove',
        style: 'destructive',
        onPress: () => void remove(),
      },
    ]);
  };
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
   * Staff + assessors only on this tab (guardians are on Manage Organization).
   * Overview uses org.memberCount so it doesn't wait on this query.
   */
  const staffCount = useMemo(
    () => membersQuery.data?.filter((m) => m.role !== 'guardian').length,
    [membersQuery.data],
  );

  if (orgQuery.isLoading) return <LoadingState message="Loading org..." />;

  const org = orgQuery.data;
  const unscoredPlayers = metrics.players - metrics.scoredPlayers;

  const openAssessment = (id: string) => {
    prefetchTryout(id);
    // Full org-manager access, not the scoped-down assessor mode — clear any
    // stale flag from a previous "Assigned Evaluations" visit to this same
    // tryout (see useAssessorMode / team/[id].tsx's same fix).
    setAssessorOnlyTryout(null);
    navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id } });
  };

  if ((platformBlockedFeatures ?? []).includes('dashboard')) {
    return (
      <Screen padded={false}>
        <View className="px-4">
          <Header title="Dashboard" showBack />
          <FeatureBlockGate feature="dashboard" />
        </View>
      </Screen>
    );
  }

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
                <Badge label={`${tryouts.length} evaluations`} variant="brand" />
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
                <Stat label="Players" value={`${metrics.players}`} hint={`${metrics.avgSize} avg / evaluation`} />
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
                <Stat label="Teams" value={`${(teamsQuery.data ?? []).filter((t) => !t.managed).length}`} />
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
                    Evaluations by Sport
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
                    Largest Evaluations
                  </Text>
                  {metrics.largest.map((t) => {
                    const isBusy = busyId === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => openAssessment(t.id)}
                        disabled={isBusy}
                        className="py-2"
                        style={isBusy ? { opacity: 0.5 } : undefined}
                      >
                        <View className="flex-row justify-between items-center">
                          <View className="flex-1 pr-2">
                            <Text className="font-bold" style={{ color: colors.ink }}>
                              {t.name}
                            </Text>
                            <Text className="text-xs mt-0.5" style={{ color: colors.inkMuted }}>
                              {t.sport} · {t.evals?.length ?? 0} evaluations
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-2">
                            <Badge label={`${t.roster?.length ?? 0}`} variant="brand" />
                            {isBusy ? (
                              <ActivityIndicator size="small" color={colors.danger} />
                            ) : (
                              <Pressable
                                onPress={() => setActionTryout({ id: t.id, name: t.name })}
                                hitSlop={8}
                                className="p-1"
                              >
                                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                                  <Path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                                </Svg>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
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
                Every evaluation is fully scored with no pending registrations.
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
                {(['admin', 'coach', 'assessor'] as const).map((role) => {
                  const count = (membersQuery.data ?? []).filter((m) => m.role === role).length;
                  return count > 0 ? <Badge key={role} label={`${role} · ${count}`} /> : null;
                })}
              </View>
              <Text className="text-xs mb-3" style={{ color: colors.inkMuted }}>
                Staff and assessors. Guardians live under Manage Organization.
              </Text>
              {(membersQuery.data ?? []).map((m) => (
                <Card key={m.id} className="mb-2 flex-row justify-between items-center gap-2">
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
                    {canManageOrganization && m.role !== 'admin' ? (
                      <Button
                        label={
                          m.role === 'assessor' || m.source === 'assessor'
                            ? 'Remove Assessor'
                            : m.role === 'guardian'
                              ? 'Revoke'
                              : 'Remove'
                        }
                        variant="danger"
                        size="sm"
                        className="mt-1"
                        onPress={() => handleRemoveMember(m)}
                        loading={removeMut.isPending && removeMut.variables === m.id}
                      />
                    ) : null}
                  </View>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      ) : null}

      <Modal
        visible={!!actionTryout}
        title="Evaluation Actions"
        onClose={() => setActionTryout(null)}
      >
        <View className="gap-3">
          <Text className="text-base mb-4" style={{ color: colors.inkMuted }}>
            What would you like to do with "{actionTryout?.name}"?
          </Text>
          <Button
            label="Archive Evaluation"
            variant="secondary"
            onPress={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                archiveTryout.mutate(actionTryout.id, { onSettled: () => setBusyId(null) });
              }
              setActionTryout(null);
            }}
          />
          <Button
            label="Delete Permanently"
            variant="danger"
            onPress={() => {
              if (actionTryout) {
                setBusyId(actionTryout.id);
                deleteTryout.mutate(actionTryout.id, { onSettled: () => setBusyId(null) });
              }
              setActionTryout(null);
            }}
          />
        </View>
      </Modal>
    </Screen>
  );
}
