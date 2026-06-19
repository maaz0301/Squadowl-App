import { Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery, useUpdateSeasonMutation } from '@/features/queries';

export default function SeasonSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const router = useRouter();
  const seasonQuery = useSeasonQuery(id);
  const updateSeason = useUpdateSeasonMutation();

  if (seasonQuery.isLoading) return <LoadingState />;
  const season = seasonQuery.data!;

  const shareSchedule = () => {
    Share.share({
      message: `Team schedule for ${season.teamName}: https://aas-tryout.app/?schedule=${season.scheduleShareToken}`,
    });
  };

  const archive = async () => {
    await updateSeason.mutateAsync({ id: id!, updates: { archived: true } });
    router.replace('/(app)/dashboard');
  };

  return (
    <Screen scroll>
      <Card accent className="mb-4 gap-2">
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>{season.name}</Text>
        <Badge label={`Token: ${season.scheduleShareToken?.slice(0, 8)}...`} variant="info" />
      </Card>
      <Button label="Share Public Schedule" variant="secondary" onPress={shareSchedule} className="mb-4" />
      <Card className="gap-2">
        <Text className="font-bold" style={{ color: colors.danger }}>Danger Zone</Text>
        <Button label="Archive Season" variant="danger" onPress={archive} loading={updateSeason.isPending} />
      </Card>
    </Screen>
  );
}
