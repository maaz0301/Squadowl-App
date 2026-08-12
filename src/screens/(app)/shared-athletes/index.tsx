import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Avatar, Badge, Card, EmptyState, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useSharedAthletesForCoachQuery } from '@/features/queries';
import type { AthleteShare, AthleteShareStatus } from '@/data/types';

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

function ShareRow({ share, colors, onPress }: { share: AthleteShare; colors: any; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2 flex-row items-center gap-3">
        <Avatar first={share.athlete.firstName} last={share.athlete.lastName} pos={share.athlete.position} size={44} uri={share.athlete.avatarUrl} />
        <View className="flex-1">
          <Text className="font-bold" style={{ color: colors.ink }}>
            {share.athlete.firstName} {share.athlete.lastName}
          </Text>
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {share.athlete.guardianName ? `Shared by ${share.athlete.guardianName}` : 'Shared profile'}
          </Text>
        </View>
        <Badge label={STATUS_LABEL[share.status]} variant={STATUS_VARIANT[share.status]} />
      </Card>
    </Pressable>
  );
}

export default function SharedAthletesScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const sharedQuery = useSharedAthletesForCoachQuery();

  if (sharedQuery.isLoading) return <LoadingState message="Loading shared athletes..." />;
  if (sharedQuery.isError) {
    return (
      <Screen padded>
        <Header title="Shared Athletes" showBack />
        <ErrorState message="Could not load shared athletes." onRetry={() => sharedQuery.refetch()} />
      </Screen>
    );
  }

  const shares = sharedQuery.data ?? [];

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Shared Athletes" showBack />
      </View>
      <FlatList
        data={shares}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            title="No shared athletes yet"
            message="When a guardian shares their athlete's profile with you, it will show up here."
          />
        }
        renderItem={({ item }) => (
          <ShareRow share={item} colors={colors} onPress={() => navigation.navigate('ShareDetail', { shareId: item.id })} />
        )}
      />
    </Screen>
  );
}
