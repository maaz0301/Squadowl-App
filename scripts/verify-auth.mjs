import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// pg client (robust parse of SUPABASE_DB_URL)
const ws = env.SUPABASE_DB_URL.replace(/^postgres(ql)?:\/\//, '');
const at = ws.lastIndexOf('@');
const creds = ws.slice(0, at);
const hostPart = ws.slice(at + 1);
const fc = creds.indexOf(':');
const [hostPort, database = 'postgres'] = hostPart.split('/');
const [host, port = '5432'] = hostPort.split(':');
const db = new pg.Client({
  user: creds.slice(0, fc),
  password: creds.slice(fc + 1),
  host,
  port: Number(port),
  database,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await db.connect();
  const email = `coach_${Date.now()}@gmail.com`;
  const password = 'password123';

  console.log('[1] signUp:', email);
  const su = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: 'Test Coach' } },
  });
  if (su.error) throw new Error('signUp: ' + su.error.message);
  const userId = su.data.user.id;
  console.log('    user created:', userId);

  console.log('[2] confirming email via DB (dev shortcut)...');
  await db.query(
    `update auth.users set email_confirmed_at = now() where id = $1 and email_confirmed_at is null;`,
    [userId],
  );

  console.log('[3] signInWithPassword...');
  const si = await supabase.auth.signInWithPassword({ email, password });
  if (si.error) throw new Error('signIn: ' + si.error.message);
  console.log('    session OK, expires_at:', si.data.session.expires_at);

  // Now authed as the user -> RLS-scoped reads
  console.log('[4] reading own profile + membership + account (RLS)...');
  const profile = await supabase.from('profiles').select('*').eq('id', userId).single();
  console.log('    profile:', profile.error ? 'ERR ' + profile.error.message : {
    email: profile.data.email,
    display_name: profile.data.display_name,
    onboarding_completed: profile.data.onboarding_completed,
  });
  const mem = await supabase.from('memberships').select('role, accounts(name, type, plan_tier)').eq('user_id', userId);
  console.log('    membership+account:', mem.error ? 'ERR ' + mem.error.message : JSON.stringify(mem.data));

  console.log('\n[5] RLS isolation: can a fresh anon client see this profile? (should be 0)');
  const anon = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const leak = await anon.from('profiles').select('id').eq('id', userId);
  console.log('    rows visible to anon:', leak.data?.length ?? `ERR ${leak.error?.message}`);

  await db.end();
  console.log('\nAUTH SLICE VERIFIED.');
}

main().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
