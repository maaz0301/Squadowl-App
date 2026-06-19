import { useState } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, ErrorState, Header, LoadingState, Screen, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useOrgQuery, useEnterprisePaymentsQuery } from '@/features/queries';

const ENT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'financials', label: 'Financials' },
  { key: 'communications', label: 'Comms' },
  { key: 'members', label: 'Members' },
] as const;

export default function EnterpriseScreen() {
  const colors = useThemeColors();
  const [tab, setTab] = useState<(typeof ENT_TABS)[number]['key']>('overview');
  const orgQuery = useOrgQuery();
  const paymentsQuery = useEnterprisePaymentsQuery();

  if (orgQuery.isLoading) return <LoadingState message="Loading org..." />;

  const org = orgQuery.data;

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Enterprise" showBack />
        <PlanGate feature="enterprise" title="Enterprise Dashboard (Association)">
          <Tabs tabs={[...ENT_TABS]} activeKey={tab} onChange={(k) => setTab(k as (typeof ENT_TABS)[number]['key'])} className="mb-4" />
        </PlanGate>
      </View>

      {tab === 'overview' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {org ? (
            <Card accent className="mb-4 gap-2">
              <Text className="text-xl font-display font-bold" style={{ color: colors.ink }}>
                {org.orgName}
              </Text>
              <Text style={{ color: colors.inkMuted }}>/{org.orgSlug}</Text>
              <View className="flex-row flex-wrap gap-2 mt-2">
                <Badge label={`${org.memberCount} members`} />
                <Badge label={`${org.assessmentCount} assessments`} variant="brand" />
                <Badge label={`${org.playerCount} players`} variant="info" />
              </View>
            </Card>
          ) : (
            <ErrorState message="No organization found." onRetry={() => orgQuery.refetch()} />
          )}
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Org Health
            </Text>
            <Text style={{ color: colors.inkMuted }}>Registration completion: 87%</Text>
            <Text style={{ color: colors.inkMuted }}>Avg assessment size: 42 players</Text>
          </Card>
        </ScrollView>
      ) : null}

      {tab === 'financials' ? (
        <FlatList
          data={paymentsQuery.data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          ListHeaderComponent={
            <Text className="text-md font-display font-bold mb-3" style={{ color: colors.ink }}>
              Payment Ledger
            </Text>
          }
          renderItem={({ item }) => (
            <Card className="mb-2 flex-row justify-between items-center">
              <View>
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {item.playerName}
                </Text>
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  {item.assessmentName}
                </Text>
              </View>
              <View className="items-end gap-1">
                <Text className="font-display font-bold" style={{ color: colors.ink }}>
                  ${item.amount}
                </Text>
                <Badge
                  label={item.status}
                  variant={item.status === 'paid' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}
                />
              </View>
            </Card>
          )}
        />
      ) : null}

      {tab === 'communications' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card accent className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Communications (Mock)
            </Text>
            <Text style={{ color: colors.inkMuted }}>Season kickoff email — sent to 128 guardians</Text>
            <Text style={{ color: colors.inkMuted }}>Tryout reminder — scheduled for Friday</Text>
            <Text style={{ color: colors.inkMuted }}>Payment follow-up — 14 pending</Text>
          </Card>
        </ScrollView>
      ) : null}

      {tab === 'members' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Card className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>
              Member Orgs (Mock)
            </Text>
            {['Northside Hockey Club', 'Metro Youth Lacrosse', 'City Basketball League'].map((m) => (
              <Text key={m} style={{ color: colors.inkMuted }}>
                {m}
              </Text>
            ))}
          </Card>
        </ScrollView>
      ) : null}
    </Screen>
  );
}
