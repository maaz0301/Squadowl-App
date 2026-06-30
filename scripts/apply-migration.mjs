import { readFileSync } from 'node:fs';
import pg from 'pg';

// Load .env
const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}

const dbUrl = env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not found in .env');
  process.exit(1);
}

// Robust parse: passwords can contain :/@!+ etc.
// Format: postgresql://USER:PASSWORD@HOST:PORT/DB
const withoutScheme = dbUrl.replace(/^postgres(ql)?:\/\//, '');
const lastAt = withoutScheme.lastIndexOf('@');
const creds = withoutScheme.slice(0, lastAt); // USER:PASSWORD
const hostPart = withoutScheme.slice(lastAt + 1); // HOST:PORT/DB
const firstColon = creds.indexOf(':');
const user = creds.slice(0, firstColon);
const password = creds.slice(firstColon + 1);
const [hostPort, database = 'postgres'] = hostPart.split('/');
const [host, port = '5432'] = hostPort.split(':');

console.log(`Connecting: user=${user} host=${host} port=${port} db=${database}`);

const file = process.argv[2] ?? 'supabase/migrations/0001_initial_schema.sql';
const sql = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
console.log('Migration file:', file);

const client = new pg.Client({
  user,
  password,
  host,
  port: Number(port),
  database,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  console.log('Connected. Applying migration 0001...');
  await client.query(sql);
  console.log('Migration applied successfully.');

  const tables = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' order by table_name;`,
  );
  console.log('\nPublic tables now present:');
  for (const r of tables.rows) console.log('  -', r.table_name);

  await client.end();
}

main().catch(async (e) => {
  console.error('\nMIGRATION FAILED:', e.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
