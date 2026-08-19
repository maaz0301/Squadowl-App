import { useMemo } from 'react';

import { useTeamsQuery } from '@/features/queries';
import { teamBrandSurfaces, type TeamBrandSurfaces } from '@/lib/teamBrand';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { Season, Team } from '@/data/types';

/**
 * Resolves the team behind a season, plus the branded surfaces its screens
 * should paint with. Season-scoped screens (schedule, roster, calendar,
 * attendance, player card) all hang off a season, but the branding — logo,
 * colour, name — lives on the team, which is what a coach actually recognizes.
 *
 * Teams are already fetched and cached for the dashboard, so this reuses that
 * query rather than adding a per-screen round trip; an unbranded or team-less
 * season falls back to the plain theme with no visible difference.
 */
export function useSeasonTeamBrand(season: Pick<Season, 'teamId' | 'teamName'> | undefined | null): {
  team: Team | undefined;
  brand: TeamBrandSurfaces;
} {
  const colors = useThemeColors();
  const teamsQuery = useTeamsQuery();

  return useMemo(() => {
    const team = season?.teamId ? teamsQuery.data?.find((t) => t.id === season.teamId) : undefined;
    return { team, brand: teamBrandSurfaces(team?.brandColor, colors) };
  }, [season?.teamId, teamsQuery.data, colors]);
}
