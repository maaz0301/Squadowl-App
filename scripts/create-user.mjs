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
  const { data, error } = await supabase.auth.signUp({
    email: 'maaz0301301@gmail.com',
    password: '123Khan@#$',
    options: {
      data: {
        first_name: 'Maaz',
        last_name: 'Khan'
      }
    }
  });

  if (error) {
    console.error("SignUp failed:", error.message);
    process.exit(1);
  }

  console.log("SignUp successful! User ID:", data.user?.id);
  console.log("Is user confirmed?:", data.user?.email_confirmed_at != null);
}

main();
