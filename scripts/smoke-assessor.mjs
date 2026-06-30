import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const ws = env.SUPABASE_DB_URL.replace(/^postgres(ql)?:\/\//, '');
const at = ws.lastIndexOf('@');
const creds = ws.slice(0, at);
const hostPart = ws.slice(at + 1);
const fc = creds.indexOf(':');
const [hostPort, database = 'postgres'] = hostPart.split('/');
const [host, port = '5432'] = hostPort.split(':');
const db = new pg.Client({
  user: creds.slice(0, fc), password: creds.slice(fc + 1),
  host, port: Number(port), database, ssl: { rejectUnauthorized: false },
});

const ok = (label, res) => {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
};

async function createUser(email, password, name) {
  const hash = bcrypt.hashSync(password, 10);
  const r = await db.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change, email_change_token_new)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated','authenticated',
       $1,$2, now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb, '','','','')
     returning id`,
    [email, hash, JSON.stringify({ display_name: name })],
  );
  return r.rows[0].id;
}

async function main() {
  await db.connect();
  const coach = createClient(URL_, KEY, { auth: { persistSession: false } });
  const assessorCli = createClient(URL_, KEY, { auth: { persistSession: false } });

  console.log('[setup] coach login + create tryout + invite assessor');
  const ci = await coach.auth.signInWithPassword({ email: 'coach@demo.com', password: 'password123' });
  if (ci.error) throw new Error('coach login: ' + ci.error.message);
  const accountId = ok('account', await coach.from('memberships').select('account_id').eq('user_id', ci.data.user.id).single()).account_id;
  const tryout = ok('tryout', await coach.from('tryouts').insert({ account_id: accountId, name: 'Assessor Smoke', event_type: 'tryout', sport: 'Hockey', settings: {} }).select().single());
  // a participant for the assessor to see
  const athlete = ok('athlete', await coach.from('athletes').insert({ account_id: accountId, first_name: 'Pat', last_name: 'Test' }).select().single());
  ok('participant', await coach.from('tryout_participants').insert({ tryout_id: tryout.id, athlete_id: athlete.id, registration_source: 'manual' }).select().single());
  // a registration (PII) that the assessor must NOT see
  ok('registration', await coach.from('registrations').insert({ tryout_id: tryout.id, first_name: 'Secret', last_name: 'Kid', guardian_name: 'Parent', guardian_email: 'p@x.com', status: 'pending' }).select().single());

  const email = `assessor_${Date.now()}@gmail.com`;
  ok('invite assessor (user_id null at this point)', await coach.from('tryout_assessors').insert({ tryout_id: tryout.id, name: 'Smoke Assessor', email, role: 'assessor' }).select().single());

  console.log('[signup] provision assessor account (fires handle_new_user link)');
  await createUser(email, 'password123', 'Smoke Assessor');

  const linked = (await db.query('select user_id, joined_at from public.tryout_assessors where lower(email)=lower($1)', [email])).rows[0];
  console.log('  linked user_id set?', !!linked.user_id, ' joined_at set?', !!linked.joined_at);
  if (!linked.user_id) throw new Error('assessor row was NOT linked on signup');

  console.log('[assessor] login + see assigned tryout via RLS');
  const ai = await assessorCli.auth.signInWithPassword({ email, password: 'password123' });
  if (ai.error) throw new Error('assessor login: ' + ai.error.message);
  const myLinks = ok('my assessor links', await assessorCli.from('tryout_assessors').select('tryout_id').eq('user_id', ai.data.user.id));
  console.log('  assigned tryout count:', myLinks.length);
  const seen = ok('assessor reads tryout', await assessorCli.from('tryouts').select('id,name').in('id', myLinks.map((l) => l.tryout_id)));
  console.log('  can see tryout:', seen.map((t) => t.name).join(', '));
  const parts = ok('assessor reads participants', await assessorCli.from('tryout_participants').select('id').eq('tryout_id', tryout.id));
  console.log('  participants visible:', parts.length);
  const regs = ok('assessor reads registrations', await assessorCli.from('registrations').select('id').eq('tryout_id', tryout.id));
  console.log('  registrations visible (should be 0):', regs.length);
  if (regs.length !== 0) throw new Error('RLS leak: assessor can see registration PII!');

  console.log('\n[cleanup]');
  ok('delete tryout', await coach.from('tryouts').delete().eq('id', tryout.id).select());
  ok('delete athlete', await coach.from('athletes').delete().eq('id', athlete.id).select());
  await db.query('delete from auth.users where lower(email)=lower($1)', [email]);
  await db.end();
  console.log('\nASSESSOR FLOW SMOKE TEST PASSED.');
}

main().catch(async (e) => {
  console.error('\nFAILED:', e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
