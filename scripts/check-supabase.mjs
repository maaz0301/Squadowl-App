import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Minimal .env loader
const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
console.log('URL:', url);

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // 1. Schema check — does the accounts table exist?
  const probe = await supabase.from('accounts').select('id').limit(1);
  if (probe.error) {
    console.log('\n[SCHEMA] accounts query error:', probe.error.code, probe.error.message);
    if (probe.error.code === '42P01') {
      console.log('>>> Schema NOT applied. Run migration 0001 in the SQL editor first.');
      return;
    }
  } else {
    console.log('\n[SCHEMA] accounts table reachable (rows visible to anon:', probe.data.length, ')');
  }

  // 2. Signup -> trigger should provision profile + account + membership
  const email = `coach_${Date.now()}@gmail.com`;
  const password = 'password123';
  console.log('\n[AUTH] signing up:', email);
  const signUp = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: 'Test Coach' } },
  });
  if (signUp.error) {
    console.log('>>> signUp error:', signUp.error.message);
    return;
  }
  let session = signUp.data.session;
  if (!session) {
    console.log('[AUTH] no session from signUp (email confirmation likely ON); trying sign-in...');
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (signIn.error) {
      console.log('>>> sign-in error:', signIn.error.message, '(confirm email or disable confirmation)');
      return;
    }
    session = signIn.session;
  }
  const userId = session.user.id;
  console.log('[AUTH] session OK, user id:', userId);

  // 3. Verify trigger provisioned rows
  const profile = await supabase.from('profiles').select('*').eq('id', userId).single();
  console.log('\n[TRIGGER] profile:', profile.error ? profile.error.message : profile.data);
  const membership = await supabase
    .from('memberships')
    .select('role, accounts(*)')
    .eq('user_id', userId);
  console.log('[TRIGGER] membership+account:', membership.error ? membership.error.message : JSON.stringify(membership.data, null, 2));

  console.log('\nDONE.');
}

main().catch((e) => console.error('FATAL', e));
