import { getSupabase } from '@/lib/supabase';

/**
 * Feature usage for the founder console's Analytics page — the mobile half of
 * the web app's src/lib/analytics.ts (same Supabase project, same
 * track_feature_use() RPC, recorded with platform 'mobile').
 *
 * The keys must match the web catalog's, since that is what the founder
 * console groups and labels by; renaming one here splits its history. A screen
 * absent from this map is simply not tracked (hub screens — Dashboard, a
 * team's own page, an assessment's Roster tab — deliberately aren't).
 *
 * Fire-and-forget: a failure (offline, migration not applied, signed out) is
 * swallowed so tracking can never break a screen. Platform admins are skipped
 * server-side.
 */
const FEATURE_BY_ROUTE: Record<string, string> = {
  NewAssessment: 'new_evaluation',
  Wizard: 'new_evaluation',
  AssessmentRinkside: 'rinkside',
  AssessmentScore: 'scoring',
  AssessmentScanSheet: 'scan_sheet',
  AssessmentTeamBuilder: 'team_builder',
  AssessmentTeamBuilderTeam: 'team_builder',
  AssessmentCompare: 'compare',
  AssessmentResults: 'results',
  AssessmentExport: 'export',
  AssessmentLetters: 'selection_letters',
  AssessmentRegistrations: 'registrations',
  AssessmentRubrics: 'rubrics',
  AssessmentRosterLibrary: 'roster_library',
  Combine: 'combine',
  SeasonSchedule: 'season_schedule',
  SeasonCalendar: 'season_schedule',
  SeasonAttendance: 'attendance',
  SeasonAvailability: 'availability',
  TeamChat: 'team_chat',
  Payments: 'payments',
  Enterprise: 'enterprise_dashboard',
  ShareDirectory: 'athlete_sharing',
  ShareDetail: 'athlete_sharing',
  SharedAthletes: 'athlete_sharing',
  Search: 'search',
  Loyalty: 'loyalty',
  GuardianPortal: 'guardian_portal',
  GuardianAssessmentDetails: 'guardian_portal',
  Upgrade: 'plans_billing',
  Feedback: 'feedback',
};

export function featureForRoute(routeName: string | undefined): string | null {
  return (routeName && FEATURE_BY_ROUTE[routeName]) || null;
}

export function trackFeatureUse(feature: string): void {
  try {
    void getSupabase()
      .rpc('track_feature_use', { p_feature: feature, p_platform: 'mobile' })
      .then(({ error }) => {
        if (error) console.debug('Feature tracking skipped:', error.message);
      });
  } catch {
    // Supabase not configured — nothing to record.
  }
}
