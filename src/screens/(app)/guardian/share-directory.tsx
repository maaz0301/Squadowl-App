import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  useAthleteSharesQuery,
  useCoachDirectoryQuery,
  useShareAthleteMutation,
} from '@/features/queries';
import type { AthleteShare, AthleteShareStatus, CoachDirectoryEntry } from '@/data/types';

const STATUS_VARIANT: Record<AthleteShareStatus, 'brand' | 'success' | 'danger' | 'default'> = {
  shared: 'brand',
  assigned: 'success',
  declined: 'danger',
  withdrawn: 'default',
  released: 'danger',
};

const STATUS_LABEL: Record<AthleteShareStatus, string> = {
  shared: 'Pending',
  assigned: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  released: 'Released',
};

function ExistingShareRow({ share, colors, onPress }: { share: AthleteShare; colors: any; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2 flex-row items-center gap-3">
        <Avatar first={share.coach.displayName} last="" size={44} uri={share.coach.avatarUrl} />
        <View className="flex-1">
          <Text className="font-bold" style={{ color: colors.ink }}>
            {share.coach.displayName}
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {share.coach.accountName}
            {share.coach.sport ? ` · ${share.coach.sport}` : ''}
          </Text>
        </View>
        <Badge label={STATUS_LABEL[share.status]} variant={STATUS_VARIANT[share.status]} />
      </Card>
    </Pressable>
  );
}

function CoachRow({
  coach,
  alreadySharedWith,
  onShare,
  loading,
  colors,
}: {
  coach: CoachDirectoryEntry;
  alreadySharedWith: boolean;
  onShare: () => void;
  loading: boolean;
  colors: any;
}) {
  return (
    <Card className="mb-2 flex-row items-center gap-3">
      <Avatar first={coach.displayName} last="" size={44} uri={coach.avatarUrl} />
      <View className="flex-1">
        <Text className="font-bold" style={{ color: colors.ink }}>
          {coach.displayName}
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {coach.accountName}
          {coach.sport ? ` · ${coach.sport}` : ''}
        </Text>
      </View>
      <Button
        label={alreadySharedWith ? 'Shared' : 'Share'}
        size="sm"
        variant={alreadySharedWith ? 'ghost' : 'primary'}
        disabled={alreadySharedWith}
        loading={loading}
        onPress={onShare}
      />
    </Card>
  );
}

export default function ShareDirectoryScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const { athleteId } = route.params || {};
  const [query, setQuery] = useState('');
  const [sharingCoachId, setSharingCoachId] = useState<string | null>(null);

  const sharesQuery = useAthleteSharesQuery(athleteId);
  const directoryQuery = useCoachDirectoryQuery();
  const shareMutation = useShareAthleteMutation();

  const sharedCoachIds = useMemo(
    () => new Set((sharesQuery.data ?? []).map((s) => s.coach.userId)),
    [sharesQuery.data],
  );

  const filteredCoaches = useMemo(() => {
    const list = directoryQuery.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.displayName.toLowerCase().includes(q) || c.accountName.toLowerCase().includes(q),
    );
  }, [directoryQuery.data, query]);

  const handleShare = async (coach: CoachDirectoryEntry) => {
    setSharingCoachId(coach.userId);
    try {
      await shareMutation.mutateAsync({
        athleteId,
        coachUserId: coach.userId,
        coachAccountId: coach.accountId,
      });
    } catch (error: any) {
      Alert.alert('Share Failed', error.message || 'Could not share this profile.');
    } finally {
      setSharingCoachId(null);
    }
  };

  if (sharesQuery.isLoading || directoryQuery.isLoading) {
    return <LoadingState message="Loading coaches..." />;
  }

  if (directoryQuery.isError) {
    return (
      <Screen padded>
        <Header title="Share with a Coach" showBack />
        <ErrorState message="Could not load the coach directory." onRetry={() => directoryQuery.refetch()} />
      </Screen>
    );
  }

  const shares = sharesQuery.data ?? [];

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Share with a Coach" showBack />
      </View>

      <FlatList
        data={filteredCoaches}
        keyExtractor={(c) => `${c.accountId}-${c.userId}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="mb-4">
            {shares.length > 0 ? (
              <View className="mb-4">
                <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
                  Your Shares
                </Text>
                {shares.map((s) => (
                  <ExistingShareRow
                    key={s.id}
                    share={s}
                    colors={colors}
                    onPress={() => navigation.navigate('ShareDetail', { shareId: s.id })}
                  />
                ))}
              </View>
            ) : null}

            <Text className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: colors.inkMuted }}>
              Find a Coach
            </Text>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search by coach or club name..."
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="No coaches found" message="Try a different search." />
        }
        renderItem={({ item }) => (
          <CoachRow
            coach={item}
            alreadySharedWith={sharedCoachIds.has(item.userId)}
            loading={shareMutation.isPending && sharingCoachId === item.userId}
            onShare={() => handleShare(item)}
            colors={colors}
          />
        )}
      />
    </Screen>
  );
}
