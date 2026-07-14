import { Text, View, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery, useUpdateSeasonMutation, useDeleteSeasonMutation, useEmailScheduleMutation } from '@/features/queries';

export default function SeasonSettingsScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const seasonQuery = useSeasonQuery(id);
  const updateSeason = useUpdateSeasonMutation();
  const deleteSeason = useDeleteSeasonMutation();
  const emailSchedule = useEmailScheduleMutation();

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return (
      <Screen scroll>
        <Header title="Settings" showBack />
        <ErrorState message="Could not load settings." onRetry={() => seasonQuery.refetch()} />
      </Screen>
    );
  }
  const season = seasonQuery.data;

  const handleEmailSchedule = async () => {
    try {
      await emailSchedule.mutateAsync(id!);
      Alert.alert('Success', 'Public schedule email sent to all roster players and guardians.');
    } catch (error: any) {
      Alert.alert('Email Failed', error.message || 'Could not send schedule emails.');
    }
  };

  const archive = async () => {
    await updateSeason.mutateAsync({ id: id!, updates: { archived: true } });
    navigation.replace('DashboardMain');
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Season',
      'Are you sure you want to delete this season? This action cannot be undone and will delete all associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSeason.mutateAsync(id!);
            navigation.replace('DashboardMain');
          },
        },
      ]
    );
  };

  return (
    <Screen scroll>
      <Header title="Settings" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>{season.name}</Text>
        <View className="flex-row">
          <Badge label={`Token: ${season.scheduleShareToken?.slice(0, 8)}...`} variant="info" />
        </View>
        {season.teamId ? (
          <View className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
            <Text className="text-xs font-bold uppercase mb-1" style={{ color: colors.inkMuted }}>
              Linked Team
            </Text>
            <Text style={{ color: colors.ink }}>{season.teamName}</Text>
            <Text className="text-xs mt-0.5" style={{ color: colors.inkFaint }}>ID: {season.teamId}</Text>
          </View>
        ) : (
          <View className="mt-2 pt-2 border-t" style={{ borderColor: colors.border }}>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>No linked team</Text>
          </View>
        )}
      </Card>
      <Button
        label="Email Schedule to Players"
        variant="secondary"
        onPress={handleEmailSchedule}
        loading={emailSchedule.isPending}
        className="mb-4"
      />
      <Card className="gap-2">
        <Text className="font-bold" style={{ color: colors.danger }}>Danger Zone</Text>
        <Button label="Archive Season" variant="danger" onPress={archive} loading={updateSeason.isPending} />
        <Button label="Delete Season" variant="danger" onPress={handleDelete} loading={deleteSeason.isPending} />
      </Card>
    </Screen>
  );
}
