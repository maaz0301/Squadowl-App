import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://jvkrgejmbuplxznnhspa.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2a3JnZWptYnVwbHh6bm5oc3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MDU3ODgsImV4cCI6MjA5ODQ4MTc4OH0.PAnQEskbEM-swpapEBQ_1tAG_m6pshzrjbS6fA_2Kmo'
);

async function run() {
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'coach@test.com',
    password: 'password123'
  });
  
  if (signInError) {
    console.error('Login failed:', signInError);
    return;
  }
  
  const user = signInData.user;
  console.log('Logged in as', user.id);
  
  const m = await supabase
    .from('memberships')
    .select('account_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
    
  if (m.error) {
    console.error('Membership error:', m.error);
    return;
  }
  
  const accountId = m.data?.account_id;
  console.log('Account ID:', accountId);
  
  if (!accountId) {
    console.error('No account id found!');
    return;
  }
  
  const teams = await supabase
    .from('teams')
    .select('*')
    .eq('account_id', accountId)
    .eq('archived', false)
    .order('created_at', { ascending: false });
    
  console.log('Teams query error:', teams.error);
  
  const tryouts = await supabase
      .from('tryouts')
      .select('*')
      .eq('account_id', accountId)
      .eq('archived', false)
      .order('created_at', { ascending: false });
      
  console.log('Tryouts query error:', tryouts.error);
}

run();
