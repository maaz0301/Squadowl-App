import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const ok = (label, res) => {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  console.log('  OK', label);
  return res.data;
};

async function main() {
  console.log('[login]');
  const si = await sb.auth.signInWithPassword({ email: 'coach@demo.com', password: 'password123' });
  if (si.error) throw new Error('login: ' + si.error.message);
  const userId = si.data.user.id;

  const m = await sb.from('memberships').select('account_id').eq('user_id', userId).limit(1).single();
  const accountId = ok('resolve account', m).account_id;

  console.log('[teams]');
  const team = ok('create team', await sb.from('teams').insert({ account_id: accountId, name: 'Smoke U14', season_label: '2026' }).select().single());

  console.log('[tryouts]');
  const tryout = ok('create tryout', await sb.from('tryouts').insert({
    account_id: accountId, team_id: team.id, name: 'Smoke Tryout', event_type: 'tryout',
    sport: 'Hockey', settings: { skaterWeights: { skating: 20 }, goalieWeights: {}, customRubrics: [] },
  }).select().single());
  ok('seed lead assessor', await sb.from('tryout_assessors').insert({
    tryout_id: tryout.id, user_id: userId, name: 'Demo Coach', email: 'coach@demo.com', role: 'lead',
  }).select().single());

  console.log('[players]');
  const athlete = ok('create athlete', await sb.from('athletes').insert({
    account_id: accountId, first_name: 'Alex', last_name: 'Smoke', year_of_birth: 2012, guardian_email: 'g@x.com',
  }).select().single());
  const participant = ok('create participant', await sb.from('tryout_participants').insert({
    tryout_id: tryout.id, athlete_id: athlete.id, jersey: '12', position: 'FWD', registration_source: 'manual',
  }).select().single());

  console.log('[evaluation]');
  const evaluation = ok('create evaluation', await sb.from('evaluations').insert({
    tryout_id: tryout.id, participant_id: participant.id, evaluator_user_id: userId,
    evaluator_name: 'Demo Coach', session: 'Session 1', recommendation: 'make', source: 'manual',
  }).select().single());
  ok('insert scores', await sb.from('evaluation_scores').insert([
    { evaluation_id: evaluation.id, rubric_key: 'skating', value: 4 },
    { evaluation_id: evaluation.id, rubric_key: 'compete', value: 5 },
  ]).select());

  console.log('[assemble: list tryouts like the app]');
  const tryouts = ok('select tryouts', await sb.from('tryouts').select('*').eq('account_id', accountId).eq('archived', false));
  const ids = tryouts.map((t) => t.id);
  const parts = ok('select participants+athletes', await sb.from('tryout_participants').select('*, athletes(*)').in('tryout_id', ids));
  const evals = ok('select evals+scores', await sb.from('evaluations').select('*, evaluation_scores(rubric_key, value)').in('tryout_id', ids));
  console.log(`  -> ${tryouts.length} tryouts, ${parts.length} participants, ${evals.length} evals`);
  const smoke = tryouts.find((t) => t.id === tryout.id);
  const roster = parts.filter((p) => p.tryout_id === tryout.id);
  console.log(`  -> "${smoke.name}" roster=${roster.length} firstPlayer=${roster[0]?.athletes?.first_name} scores=${JSON.stringify((evals[0]?.evaluation_scores ?? []))}`);

  console.log('[seasons]');
  const season = ok('create season', await sb.from('seasons').insert({
    account_id: accountId, name: 'Smoke Season', team_name: 'U14', sport: 'Hockey', schedule_share_token: 'smoke_' + Date.now(),
  }).select().single());
  ok('add event', await sb.from('season_events').insert({ season_id: season.id, kind: 'game', title: 'Game 1', event_date: '2026-03-20' }).select().single());

  console.log('\n[cleanup]');
  ok('delete tryout (cascade)', await sb.from('tryouts').delete().eq('id', tryout.id).select());
  ok('delete season (cascade)', await sb.from('seasons').delete().eq('id', season.id).select());
  ok('delete team', await sb.from('teams').delete().eq('id', team.id).select());
  ok('delete athlete', await sb.from('athletes').delete().eq('id', athlete.id).select());

  console.log('\nCOACH FLOW SMOKE TEST PASSED.');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
