-- Add avatar_url column to athletes and profiles tables
ALTER TABLE public.athletes ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;


-- Create the avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Add RLS policies for avatars storage bucket
CREATE POLICY "Public Read Access for Avatars" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated Write Access for Avatars" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Authenticated Update Access for Avatars" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Authenticated Delete Access for Avatars" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'avatars');
