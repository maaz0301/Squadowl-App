import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useSeasonQuery, usePortalInviteMutation } from '@/features/queries';

export default function SeasonPlayerScreen() {
  const { id, playerId } = useLocalSearchParams<{ id: string; playerId: string }>();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const portalInvite = usePortalInviteMutation(id!);
  const [email, setEmail] = useState('');

  if (seasonQuery.isLoading) return <LoadingState />;
  const player = seasonQuery.data?.roster.find((p) => p.id === playerId);
  if (!player) {
    return (
      <Screen scroll>
        <Header title="Player" showBack />
        <EmptyState title="Player not found" message="This player may have been removed from the roster." />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title={`${player.firstName} ${player.lastName}`} showBack />
      <Card className="mb-4 gap-2">
        <Text style={{ color: colors.inkMuted }}>Jersey #{player.jersey ?? '—'}</Text>
        <Text style={{ color: colors.ink }}>{player.guardianEmail ?? 'No guardian email'}</Text>
        {player.portalInviteSentAt ? (
          <Badge label={`Invited ${new Date(player.portalInviteSentAt).toLocaleDateString()}`} variant="success" />
        ) : null}
      </Card>

      <PlanGate feature="guardianPortal" title="Guardian Portal (Coach+)">
        <Card accent className="gap-3">
          <Text className="font-display font-bold" style={{ color: colors.ink }}>
            Send Portal Invite
          </Text>
          <Input
            label="Email"
            value={email || player.guardianEmail || ''}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Button
            label="Send Invite"
            loading={portalInvite.isPending}
            onPress={() =>
              portalInvite.mutate({ playerId: playerId!, email: email || player.guardianEmail || '' })
            }
          />
        </Card>
      </PlanGate>
    </Screen>
  );
}
