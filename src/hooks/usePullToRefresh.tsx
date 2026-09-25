import { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Pull-to-refresh for a list or scroll view.
 *
 * Hand it the refetches for the queries the screen shows and spread the result
 * onto the list: `<FlatList refreshControl={refreshControl} … />`. The spinner
 * stays until every refetch has settled. A failed refetch is not thrown at the
 * user — the screen's own error state and the query's cached data already say
 * what is wrong — so the spinner just stops.
 */
export function usePullToRefresh(refetchAll: () => Promise<unknown>) {
  const colors = useThemeColors();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchAll();
    } catch {
      // See above: nothing to add to what the screen already shows.
    } finally {
      setRefreshing(false);
    }
  }, [refetchAll]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.primary}
      colors={[colors.primary]}
      progressBackgroundColor={colors.card}
    />
  );
}
