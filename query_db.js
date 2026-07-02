const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  // Query tryout_participants where id = '58747911-ece7-4647-914c-947b8ff087ed'
  const { data: tp, error: tpError } = await supabase
    .from('tryout_participants')
    .select('*, athletes(*)')
    .eq('id', '58747911-ece7-4647-914c-947b8ff087ed')
    .single();

  console.log('--- Participant ---');
  console.log(JSON.stringify(tp, null, 2));
  console.log('Error:', tpError);

  if (tp && tp.athlete_id) {
    const { data: at, error: atError } = await supabase
      .from('athletes')
      .select('*')
      .eq('id', tp.athlete_id)
      .single();
    
    console.log('\n--- Athlete Direct Query ---');
    console.log(JSON.stringify(at, null, 2));
    console.log('Error:', atError);
  }
}

main().catch(console.error);
