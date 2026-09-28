import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useAdminStatsQuery, useAdminUsersQuery, useOverridePlanMutation } from '@/features/queries';

const ADMIN_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'billing', label: 'Billing' },
  { key: 'support', label: 'Support' },
] as const;

export default function AdminScreen() {
  const colors = useThemeColors();
  const [tab, setTab] = useState<(typeof ADMIN_TABS)[number]['key']>('overview');
  const statsQuery = useAdminStatsQuery();
  const usersQuery = useAdminUsersQuery();
  const overridePlan = useOverridePlanMutation();

  if (statsQuery.isLoading) return <LoadingState message="Loading admin..." />;
  if (statsQuery.isError || !statsQuery.data) {
    return (
      <Screen scroll>
        <Header title="Admin Portal" showBack />
        <ErrorState message="Could not load admin data." onRetry={() => statsQuery.refetch()} />
      </Screen>
    );
  }

  const stats = statsQuery.data;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Admin Portal" subtitle="Super Admin (Demo)" showBack />
        <PlanGate feature="enterprise" title="Admin Portal">
          <Tabs tabs={[...ADMIN_TABS]} activeKey={tab} onChange={(k) => setTab(k as (typeof ADMIN_TABS)[number]['key'])} className="mb-4" />
        </PlanGate>
      </View>

      {tab === 'overview' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Card accent className="mb-4 gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Platform Overview
            </Text>
            <View className="flex-row flex-wrap gap-2 mt-2">
              <Badge label={`${stats.totalUsers} users`} variant="brand" />
              <Badge label={`${stats.activeUsers} active`} variant="success" />
              <Badge label={`${stats.totalAssessments} evaluations`} />
              <Badge label={`$${stats.revenueMtd} MTD`} variant="info" />
            </View>
          </Card>
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Recent Activity (Mock)
            </Text>
            <Text style={{ color: colors.inkMuted }}>12 new registrations today</Text>
            <Text style={{ color: colors.inkMuted }}>3 evaluations exported</Text>
            <Text style={{ color: colors.inkMuted }}>1 enterprise org onboarded</Text>
          </Card>
        </ScrollView>
      ) : null}

      {tab === 'users' ? (
        <FlatList
          data={usersQuery.data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <Card className="mb-2 gap-2">
              <View className="flex-row justify-between">
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {item.displayName}
                </Text>
                <Badge label={item.planTier} />
              </View>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {item.email}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkFaint }}>
                {item.teamCount} teams · {item.assessmentCount} evaluations
              </Text>
              {item.planTier !== 'club' ? (
                <Button
                  label="Upgrade to Club"
                  size="sm"
                  variant="secondary"
                  onPress={() => overridePlan.mutate({ userId: item.id, planTier: 'club' })}
                  loading={overridePlan.isPending}
                />
              ) : null}
            </Card>
          )}
        />
      ) : null}

      {tab === 'billing' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card accent className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Billing (Mock)
            </Text>
            <Text style={{ color: colors.inkMuted }}>MTD revenue: ${stats.revenueMtd}</Text>
            <Text style={{ color: colors.inkMuted }}>Active subscriptions: {stats.activeUsers}</Text>
            <Text style={{ color: colors.inkMuted }}>Failed payments: 2 (demo)</Text>
          </Card>
        </ScrollView>
      ) : null}

      {tab === 'support' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Support Queue (Mock)
            </Text>
            {['Password reset: coach@example.com', 'Export issue: club tier', 'QR code not loading'].map(
              (ticket) => (
                <Pressable key={ticket} className="py-2 border-b" style={{ borderColor: colors.border }}>
                  <Text style={{ color: colors.ink }}>{ticket}</Text>
                </Pressable>
              ),
            )}
          </Card>
        </ScrollView>
      ) : null}
    </Screen>
  );
}
