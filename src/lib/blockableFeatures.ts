/**
 * The hub sections a founder can turn off for the whole platform from the
 * web app's console — a lighter tool than Suspend. See
 * 20260923120000_founder_feature_blocks.sql in the web repo, which owns the
 * schema both apps share, and src/lib/blockableFeatures.ts there.
 *
 * This is a UI-level gate: the app hides the nav entry and shows a blocked
 * screen in its place, not a data boundary enforced by RLS.
 */
export const BLOCKABLE_FEATURES = [
  'evaluations',
  'teams',
  'dashboard',
  'profile',
  'myAthletes',
  'organization',
  'loyalty',
  'billing',
] as const;

export type BlockableFeature = (typeof BLOCKABLE_FEATURES)[number];

export const BLOCKABLE_FEATURE_LABEL: Record<BlockableFeature, string> = {
  evaluations: 'Evaluations',
  teams: 'Teams',
  dashboard: 'Dashboard',
  profile: 'Profile',
  myAthletes: 'My Athletes',
  organization: 'Manage Organization',
  loyalty: 'Loyalty Program',
  billing: 'Plans & Billing',
};

export function isBlockableFeature(value: string): value is BlockableFeature {
  return (BLOCKABLE_FEATURES as readonly string[]).includes(value);
}
