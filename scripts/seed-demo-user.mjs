import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const EMAIL = 'coach@demo.com';
const PASSWORD = 'password123';
const DISPLAY = 'Demo Coach';

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

  const existing = await db.query('select id from auth.users where email = $1', [EMAIL]);
  if (existing.rows.length) {
    console.log('User already exists — ensuring confirmed.');
    await db.query(
      'update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where email = $1',
      [EMAIL],
    );
    await db.end();
    console.log(`Demo login ready:\n  email: ${EMAIL}\n  password: ${PASSWORD}`);
    return;
  }

  const hash = bcrypt.hashSync(PASSWORD, 10);

  // Direct insert into auth.users. The on_auth_user_created trigger provisions
  // profile + account + membership. Empty-string token columns avoid GoTrue's
  // NULL-scan login bug.
  await db.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', $1, $2,
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       $3::jsonb,
       '', '', '', ''
     )`,
    [EMAIL, hash, JSON.stringify({ display_name: DISPLAY })],
  );

  const check = await db.query(
    `select p.display_name, a.type, a.plan_tier, m.role
       from auth.users u
       join public.profiles p on p.id = u.id
       join public.memberships m on m.user_id = u.id
       join public.accounts a on a.id = m.account_id
      where u.email = $1`,
    [EMAIL],
  );
  console.log('Provisioned:', check.rows[0]);

  await db.end();
  console.log(`\nDemo login ready:\n  email: ${EMAIL}\n  password: ${PASSWORD}`);
}

main().catch(async (e) => {
  console.error('FAILED:', e.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
