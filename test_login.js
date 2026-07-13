const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function main() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const urlMatch = envContent.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/);
  const anonMatch = envContent.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/);
  
  if (!urlMatch || !anonMatch) {
    console.log("Could not find Supabase credentials in .env");
    return;
  }
  
  const supabase = createClient(urlMatch[1], anonMatch[1]);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'teuffuttireutre-3836@yopmail.com',
    password: '4fevmdAa1!'
  });
  
  if (error) {
    console.log("Login failed:", error.message);
  } else {
    console.log("Login successful! User ID:", data.user.id);
  }
}
main();
