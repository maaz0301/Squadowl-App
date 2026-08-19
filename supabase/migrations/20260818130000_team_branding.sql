-- ============================================================================
-- Team branding
-- ----------------------------------------------------------------------------
-- Teams could already carry a logo (20260803140000_team_logo). This adds the
-- other half of "personalize the team": a brand colour that the team banner,
-- headers, and exported/printed results tint themselves with.
--
-- Stored as a "#RRGGBB" string rather than a palette key so a club can match
-- its actual jersey colour, and checked in the database so a bad value can't
-- reach the UI and render as a transparent/black banner.
-- ============================================================================

alter table public.teams
  add column if not exists brand_color text
    check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.teams.brand_color is
  'Team brand colour as #RRGGBB, used for the team banner and printed results. Null = use the app theme.';
