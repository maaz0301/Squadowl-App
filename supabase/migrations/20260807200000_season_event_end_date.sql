-- Multi-day events: season_events.event_date was the only date column, so a
-- tournament or road trip spanning several days had no way to record when it
-- ends. Nullable and defaulted to event_date for existing rows so single-day
-- events (the common case) don't need a value.
alter table public.season_events add column end_date date;
update public.season_events set end_date = event_date where end_date is null;
alter table public.season_events add constraint season_events_end_date_check check (end_date >= event_date);
