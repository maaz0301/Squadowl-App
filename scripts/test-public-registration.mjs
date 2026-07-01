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

async function testPublicRegistration() {
  console.log('Testing public registration RPC...');
  
  // Try to find a valid registration code first by authenticating as coach
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'maaz.khan@ccript.com',
    password: '123khan'
  });
  
  if (signInError) {
    console.error("Login failed:", signInError.message);
    process.exit(1);
  }
  
  const { data: tryouts } = await supabase.from('tryouts').select('registration_code, registration_open').eq('registration_open', true).limit(1);
  const code = tryouts?.[0]?.registration_code;
  
  if (!code) {
    console.log("No open tryouts found to test public registration.");
    process.exit(0);
  }
  
  // Sign out to act as public
  await supabase.auth.signOut();
  
  const payload = {
    firstName: 'Public',
    lastName: 'Athlete',
    yearOfBirth: '2010',
    positionTryingOutFor: 'FWD',
    guardianName: 'Public Guardian',
    guardianEmail: 'guardian@example.com'
  };
  
  const { data, error } = await supabase.rpc('submit_public_registration', { code, payload });
  
  if (error) {
    console.error("Public registration failed:", error.message);
    console.log("Note: This likely means the migration 0003_public_registration_rpc.sql has not been applied to the live database.");
    process.exit(1);
  }
  
  console.log("Public registration succeeded!", data);
}

testPublicRegistration();
