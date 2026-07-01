import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'coach@example.com',
    password: 'password123'
  });

  if (signInError) {
    console.error("Login failed:", signInError.message);
    process.exit(1);
  }

  console.log("Login successful! User ID:", signInData.user.id);
  
  // Try fetching profile
  console.log("Fetching profile...");
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', signInData.user.id)
    .single();

  if (profileError) {
    console.error("Profile Error:", profileError);
  } else {
    console.log("Profile:", profile);
  }

  // Try fetching membership
  const { data: mem, error: memError } = await supabase
    .from('memberships')
    .select('role, accounts(*)')
    .eq('user_id', signInData.user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memError) {
    console.error("Membership Error:", memError);
  } else {
    console.log("Membership:", mem);
  }
}

main();
