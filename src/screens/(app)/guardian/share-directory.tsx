import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { Avatar, Badge, Button, Card, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  useAthleteSharesQuery,
  useFindCoachByEmailMutation,
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
  const [email, setEmail] = useState('');
  // The email a lookup actually ran for, so the empty/no-match state below
  // reads "no coach found for x@y.com" rather than re-running on every
  // keystroke — this is a real network round trip per search, not a filter
  // over an already-loaded list.
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const [sharingCoachId, setSharingCoachId] = useState<string | null>(null);

  const sharesQuery = useAthleteSharesQuery(athleteId);
  const findCoach = useFindCoachByEmailMutation();
  const shareMutation = useShareAthleteMutation();

  const sharedCoachIds = useMemo(
    () => new Set((sharesQuery.data ?? []).map((s) => s.coach.userId)),
    [sharesQuery.data],
  );

  const handleFind = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSearchedEmail(trimmed);
    findCoach.mutate(trimmed);
  };

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

  if (sharesQuery.isLoading) {
    return <LoadingState message="Loading..." />;
  }

  const shares = sharesQuery.data ?? [];
  const results = findCoach.data ?? [];

  return (
    <Screen padded scroll>
      <Header title="Share with a Coach" showBack />

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
        Share by Email
      </Text>
      <Text className="text-sm mb-3" style={{ color: colors.inkMuted }}>
        Enter the coach&apos;s email address to send them this athlete&apos;s profile.
      </Text>
      <View className="flex-row gap-2 items-start mb-4">
        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="coach@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          containerClassName="flex-1"
          onSubmitEditing={handleFind}
          returnKeyType="search"
        />
        <Button label="Find" loading={findCoach.isPending} disabled={!email.trim()} onPress={handleFind} />
      </View>

      {findCoach.isPending ? (
        <LoadingState message="Looking up that email..." />
      ) : findCoach.isError ? (
        <ErrorState
          message={(findCoach.error as any)?.message || 'Could not look up that email.'}
          onRetry={handleFind}
        />
      ) : searchedEmail && results.length === 0 ? (
        <Card className="items-center py-6 gap-1">
          <Text className="font-bold text-center" style={{ color: colors.ink }}>
            No coach found for {searchedEmail}
          </Text>
          <Text className="text-sm text-center" style={{ color: colors.inkMuted }}>
            Double-check the address, or ask them to create a TryoutHQ account first.
          </Text>
        </Card>
      ) : (
        results.map((c) => (
          <CoachRow
            key={`${c.accountId}-${c.userId}`}
            coach={c}
            alreadySharedWith={sharedCoachIds.has(c.userId)}
            loading={shareMutation.isPending && sharingCoachId === c.userId}
            onShare={() => handleShare(c)}
            colors={colors}
          />
        ))
      )}
    </Screen>
  );
}
