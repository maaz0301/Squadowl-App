-- Create fcm_tokens table
create table public.fcm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

-- Add index on user_id for faster lookups
create index fcm_tokens_user_id_idx on public.fcm_tokens(user_id);

-- Enable Row Level Security
alter table public.fcm_tokens enable row level security;

-- Policy: Users can insert their own tokens
create policy "Users can insert their own fcm tokens"
  on public.fcm_tokens
  for insert
  with check (auth.uid() = user_id);

-- Policy: Users can view their own tokens
create policy "Users can view their own fcm tokens"
  on public.fcm_tokens
  for select
  using (auth.uid() = user_id);

-- Policy: Users can delete their own tokens
create policy "Users can delete their own fcm tokens"
  on public.fcm_tokens
  for delete
  using (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_fcm_tokens_updated_at
  before update on public.fcm_tokens
  for each row
  execute function public.handle_updated_at();
