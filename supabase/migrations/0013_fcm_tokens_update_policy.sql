-- Add UPDATE policy for fcm_tokens to support upsert operations
create policy "Users can update their own fcm tokens"
  on public.fcm_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
