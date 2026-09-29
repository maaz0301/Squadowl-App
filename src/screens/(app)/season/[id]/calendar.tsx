import { ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { TeamBanner } from '@/components/TeamBanner';
import { MonthCalendar } from '@/components/MonthCalendar';
import { useSeasonTeamBrand } from '@/features/useTeamBrand';
import { ErrorState, LoadingState, Screen } from '@/components/ui';
import { useSeasonQuery } from '@/features/queries';

export default function SeasonCalendarScreen() {
  const route = useRoute<any>();
  const { id } = route.params || {};
  const seasonQuery = useSeasonQuery(id);

  // Hook, so it runs before the loading/error guards — skipping it on the
  // loading render would change hook order. Undefined season -> plain theme.
  const { team, brand } = useSeasonTeamBrand(seasonQuery.data);

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load calendar." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;

  return (
    <Screen scroll padded={false} backgroundColor={brand.screenBg}>
      {team ? <TeamBanner team={team} className="px-4 pt-3" /> : null}
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <MonthCalendar events={season.events} teamName={season.teamName} />
      </ScrollView>
    </Screen>
  );
}
