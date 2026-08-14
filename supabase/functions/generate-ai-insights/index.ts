// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Best-effort recovery for JSON truncated mid-value (e.g. the model hit max_tokens
// partway through an array). Closes any unterminated string/array/object so a
// partial-but-valid result can still be parsed instead of throwing outright.
function repairTruncatedJson(str: string): string {
  let repaired = str;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/, '');
  while (stack.length) {
    repaired += stack.pop() === '{' ? '}' : ']';
  }
  return repaired;
}

// Pull an explicit team-count / team-size number out of the user's free-text
// instructions so it can be restated to Claude as an unambiguous hard
// constraint, instead of trusting the model to notice a number buried in a
// paragraph and hold onto it through a long roster/rankings payload.
function detectTeamConstraints(text: string): { teamCount?: number; teamSize?: number } {
  const lower = (text || '').toLowerCase();
  const countMatch = lower.match(/(\d+)\s*teams?\b/);
  const sizeMatch =
    lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\b(?:\s+\w+){0,2}?\s*team/) ||
    lower.match(/teams?\s*of\s*(\d+)/) ||
    // Fallback for phrasing like "5 players each"/"5 athletes per" where "team"
    // isn't repeated near the size (it was already said earlier, e.g. "2 teams
    // ... 5 players each for the hockey").
    lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\s*(?:each|per|apiece)\b/);
  return {
    teamCount: countMatch ? parseInt(countMatch[1], 10) : undefined,
    teamSize: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
  };
}

// Sanity-checks Claude's team_builder response against the roster and any
// numeric constraints detected in the prompt. Returns a list of human-readable
// issues (empty = valid) so the caller can retry with a corrective follow-up
// instead of silently handing the client a response with the wrong team count
// or dropped/duplicated players.
function validateTeamBuilderResult(
  result: any,
  players: any[],
  constraints: { teamCount?: number; teamSize?: number },
): string[] {
  const issues: string[] = [];
  const teams = Array.isArray(result?.teams) ? result.teams : [];
  const unassigned: string[] = Array.isArray(result?.unassigned) ? result.unassigned : [];
  if (constraints.teamCount && teams.length !== constraints.teamCount) {
    issues.push(`you returned ${teams.length} teams but the user asked for exactly ${constraints.teamCount}`);
  }

  const rosterIds = new Set(players.map((p: any) => p.id));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const allTeamIds: string[] = [];
  for (const t of teams) {
    for (const id of t?.players || []) allTeamIds.push(id);
  }
  const allIds = [...allTeamIds, ...unassigned];
  for (const id of allIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    issues.push(`${duplicates.size} player ID(s) appear more than once across teams/unassigned`);
  }
  const missing = [...rosterIds].filter((id) => !seen.has(id as string));
  if (missing.length > 0) {
    issues.push(`${missing.length} roster player(s) were left off every team and the unassigned list`);
  }
  const extra = allIds.filter((id) => !rosterIds.has(id));
  if (extra.length > 0) {
    issues.push(`${extra.length} player ID(s) in the response don't match any roster player`);
  }

  // When both a team count and a fixed team size were requested, the roster
  // may not divide evenly. Rather than letting the model silently pad one
  // team with the remainder, any players beyond capacity must show up in
  // "unassigned" and every team must be exactly teamSize.
  if (constraints.teamCount && constraints.teamSize) {
    const capacity = constraints.teamCount * constraints.teamSize;
    if (players.length > capacity) {
      const expectedUnassigned = players.length - capacity;
      if (unassigned.length !== expectedUnassigned) {
        issues.push(`"unassigned" must contain exactly ${expectedUnassigned} player ID(s) (${players.length} players - ${capacity} capacity), but it has ${unassigned.length}`);
      }
      for (const t of teams) {
        const n = (t?.players || []).length;
        if (n !== constraints.teamSize) {
          issues.push(`team "${t?.name}" has ${n} players but every team must have exactly ${constraints.teamSize}`);
        }
      }
    } else if (unassigned.length > 0) {
      issues.push(`"unassigned" must be empty — there are only ${players.length} players for ${capacity} slots, so everyone should be assigned to a team`);
    }
  }

  return issues;
}

// Deterministically repairs the common near-miss mistakes Claude makes on large
// rosters — a stray duplicated ID, a hallucinated ID, a player dropped entirely —
// instead of rejecting the whole response and burning a retry (and more latency)
// on an otherwise-good team split. Every roster ID ends up on exactly one team
// (first team it was seen on, preserving the model's placement intent) or in
// "unassigned" if it was never validly placed. Numeric constraints (team count/
// size) are NOT something this can safely patch, so validateTeamBuilderResult
// still runs afterward to catch those and trigger a real corrective retry.
function reconcileTeamBuilderResult(result: any, players: any[]): any {
  const rosterIds = players.map((p: any) => p.id);
  const rosterSet = new Set(rosterIds);
  const teams = Array.isArray(result?.teams) ? result.teams : [];
  const assigned = new Set<string>();

  const cleanedTeams = teams.map((t: any) => {
    const seenInTeam = new Set<string>();
    const cleanedPlayers = (Array.isArray(t?.players) ? t.players : []).filter((id: string) => {
      if (!rosterSet.has(id) || assigned.has(id) || seenInTeam.has(id)) return false;
      seenInTeam.add(id);
      assigned.add(id);
      return true;
    });
    return { ...t, players: cleanedPlayers };
  });

  const unassigned = rosterIds.filter((id) => !assigned.has(id));
  return { ...result, teams: cleanedTeams, unassigned };
}

async function callClaudeForJson(systemPrompt: string, promptText: string, maxTok: number): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTok,
      system: systemPrompt,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.7,
      // Stream so a large team_builder response (up to 64000 tokens) doesn't
      // sit on one blocking read and risk an HTTP timeout.
      stream: true,
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error: ${errBody.error?.message || JSON.stringify(errBody)}`);
  }

  // Accumulate the SSE stream into the full response text.
  let content = '';
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice('data: '.length));
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        content += event.delta.text;
      } else if (event.type === 'error') {
        throw new Error(`Anthropic API stream error: ${event.error?.message || JSON.stringify(event.error)}`);
      }
    }
  }

  // Strip markdown code fences that Claude sometimes adds (e.g. ```json ... ```)
  // Also handle cases where there's text before/after the JSON block
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```\s*$/i, '').trim();
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const jsonStart = cleaned.search(/[{[]/);
    if (jsonStart !== -1) cleaned = cleaned.slice(jsonStart);
  }
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
    cleaned = cleaned.slice(0, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    // Response was likely cut off mid-array/object (hit max_tokens). Try to salvage
    // it by closing any unterminated string/array/object rather than failing outright.
    try {
      return JSON.parse(repairTruncatedJson(cleaned));
    } catch {
      throw new Error('The AI response was incomplete or malformed. Please try again.');
    }
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }

    const { action, tryout, playerIds, prompt: userPrompt, comparisonProfiles } = await req.json();

    if (!action || !tryout) {
      throw new Error('Missing required fields: action or tryout');
    }
    if ((action === 'summary' || action === 'compare') && (!playerIds || playerIds.length === 0)) {
      throw new Error('Missing playerIds for summary or compare action');
    }

    let prompt = '';
    let maxTokens = 1024;
    let teamBuilderPlayers: any[] = [];
    let teamBuilderConstraints: { teamCount?: number; teamSize?: number } = {};
    let systemPrompt = `You are a professional sports scout AI. Your ONLY job is to analyze the numeric evaluation data provided to you from an athlete assessment app database.
RULES:
- Analyze ONLY the evaluation scores and fields in the JSON data provided. Do not make assumptions based on athlete names.
- Do NOT question whether the sport type matches the player names. The data is from the app database — trust it completely.
- Do NOT refuse or add disclaimers about data mismatches. If data exists, analyze it.
- Do NOT mention hockey, soccer, or any sport unless it appears explicitly in the data.
- Respond with pure JSON only — no markdown, no code fences, no extra text.`;

    if (action === 'summary') {
      const playerId = playerIds[0];
      const player = tryout.roster.find((p: any) => p.id === playerId);
      const evals = tryout.evals.filter((e: any) => e.playerId === playerId);

      if (evals.length === 0) {
        return new Response(JSON.stringify({ error: 'no_evals', message: 'This player has no evaluation data yet. Score the player first before generating an AI summary.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      prompt = `Analyze this athlete's performance based purely on their evaluation scores from the app database.

Athlete: ${player?.first} ${player?.last} | Position: ${player?.pos || 'N/A'} | Total evaluations: ${evals.length}

Evaluation records (each contains numeric category scores from 1-5 and an optional recommendation):
${JSON.stringify(evals, null, 2)}

Based ONLY on the numeric scores above, return this exact JSON:
{
  "summary": "2-3 sentence performance summary based on the scores above.",
  "key_strengths": ["top scoring category 1", "top scoring category 2"],
  "key_growth": ["lowest scoring category 1", "lowest scoring category 2"],
  "role_fit": "Recommended role based on their score profile.",
  "confidence": 0.85,
  "trend": "improving"
}
The "trend" field must be one of: "improving", "steady", "declining", or "insufficient_data".`;

    } else if (action === 'compare' && !comparisonProfiles) {
      // Legacy path: some callers (e.g. the web app) still send the raw
      // { tryout, playerIds } shape without pre-computed comparisonProfiles.
      // Keep the original raw-eval prompt for them so this stays working
      // without every caller having to compute weighted stats client-side.
      const players = tryout.roster.filter((p: any) => playerIds.includes(p.id));
      const evals = tryout.evals.filter((e: any) => playerIds.includes(e.playerId));

      if (evals.length === 0) {
        return new Response(JSON.stringify({ error: 'no_evals', message: 'None of the selected players have evaluation data yet. Score the players first before comparing.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      prompt = `Compare these athletes based purely on their evaluation scores from the app database.

Athletes:
${players.map((p: any) => `- ${p.first} ${p.last} (Pos: ${p.pos || 'N/A'}, ID: ${p.id})`).join('\n')}

Evaluation records (numeric category scores 1-5 per athlete, identified by playerId):
${JSON.stringify(evals, null, 2)}

Based ONLY on the numeric scores above, return this exact JSON:
{
  "summary": "2-3 sentence comparison based on their actual scores.",
  "edge": "Which athlete scores higher overall and in which categories.",
  "best_fit": "First and last name of the highest-scoring athlete overall.",
  "watch_list": ["First Last"],
  "recommendation": "Concrete recommendation for coaching staff based on the scores."
}`;
    } else if (action === 'compare') {
      const profiles: any[] = comparisonProfiles || [];
      const evaluated = profiles.filter((p) => p.evalCount > 0);
      const unevaluated = profiles.filter((p) => p.evalCount === 0);

      if (evaluated.length === 0) {
        return new Response(JSON.stringify({ error: 'no_evals', message: 'None of the selected players have evaluation data yet. Score the players first before comparing.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // Compact, pre-computed per-player stats (pooled weighted overall,
      // per-category averages, per-session trend) rather than raw eval
      // records — grounds the model in the same numbers the app itself
      // computes and keeps the payload flat as session count grows.
      maxTokens = 1536;
      prompt = `Compare these athletes based purely on the pre-computed evaluation stats below (weighted overall 1-5, per-category averages 1-5, and per-session trend).

Athletes with evaluation data:
${evaluated.map((p) => `- ${p.name} (Pos: ${p.pos}, ${p.evalCount} session(s) scored)
  Overall: ${p.overall}
  Latest recommendation: ${p.latestRecommendation || 'None'}
  Category averages: ${p.categories.length ? p.categories.map((c: any) => `${c.label}=${c.score}`).join(', ') : 'None scored'}
  Session trend: ${p.sessionTrend.length ? p.sessionTrend.map((s: any) => `${s.session}=${s.overall}`).join(' -> ') : 'N/A'}`).join('\n')}
${unevaluated.length ? `\nAthletes selected but with NO evaluation data yet (mention once in the summary that they have no data; do NOT include them in category_edges, watch_list, best_fit, or player_notes; NEVER invent scores for them):\n${unevaluated.map((p: any) => `- ${p.name}`).join('\n')}` : ''}

Based ONLY on the stats above, return this exact JSON:
{
  "summary": "2-3 sentence comparison grounded in the actual overall/category numbers above.",
  "edge": "Which athlete scores higher overall and in which specific categories, citing the numbers.",
  "best_fit": "First and last name of the highest-scoring evaluated athlete overall.",
  "watch_list": ["First Last of any evaluated athlete trending upward across sessions, or standing out in one category"],
  "recommendation": "Concrete recommendation for coaching staff based on the scores.",
  "category_edges": [
    {"category": "Category label", "leader": "First Last", "note": "One short sentence citing the actual scores that decided this category."}
  ],
  "player_notes": [
    {"name": "First Last", "strength": "Their strongest category and score.", "growth": "Their weakest category and score."}
  ]
}
Include one "category_edges" entry per category that appears in the stats above (skip categories where scores tie exactly). Include one "player_notes" entry per evaluated athlete.`;
    } else if (action === 'team_builder') {
      const players = tryout.roster || [];
      teamBuilderPlayers = players;
      // Pre-computed per-player ranking (weighted overall 1-5 + category averages),
      // pooled across all evaluations/sessions client-side. Using this instead of raw
      // eval records keeps the prompt one row per player regardless of roster size or
      // eval count, so it doesn't blow past the model's input token limit on large rosters.
      const rankings = tryout.rankings || [];

      if (players.length === 0) {
        return new Response(JSON.stringify({ error: 'no_players', message: 'No players in roster to build teams.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // The response must enumerate every player ID once (in "players") across every
      // team, so the token budget must scale with roster size or large rosters get
      // truncated mid-array and fail JSON.parse. Capped at 64000 — claude-haiku-4-5's
      // max output token ceiling; skaters/goalies are split out client-side from the
      // roster's own position data instead of asking the model to repeat every ID a
      // second time, which used to roughly double output size and risk truncation
      // well before 1000 players.
      maxTokens = Math.min(64000, 1024 + players.length * 35);

      const rawConstraints = detectTeamConstraints(userPrompt || '');
      teamBuilderConstraints = {
        teamCount: rawConstraints.teamCount ?? (rawConstraints.teamSize ? Math.max(1, Math.floor(players.length / rawConstraints.teamSize)) : undefined),
        teamSize: rawConstraints.teamSize,
      };
      const capacity = teamBuilderConstraints.teamCount && teamBuilderConstraints.teamSize
        ? teamBuilderConstraints.teamCount * teamBuilderConstraints.teamSize
        : undefined;

      systemPrompt = `You are a professional sports coach and team builder AI.
RULES:
- Follow the user's instructions perfectly.
- Use ALL data provided to you, including the Roster text (which contains names, positions, YOB, and friends) AND the ranking JSON (weighted overall score 1-5 and per-category averages, pooled across every evaluation for that athlete).
- Do NOT make assumptions based on athlete names.
- Do NOT refuse or add disclaimers. If data exists, use it.
- NEVER include player IDs or sensitive personal data in the 'explanation' text.
- Respond with pure JSON only — no markdown, no code fences, no extra text.`;

      const assignmentInstruction = capacity !== undefined
        ? `HARD CONSTRAINT: Create EXACTLY ${teamBuilderConstraints.teamCount} teams with EXACTLY ${teamBuilderConstraints.teamSize} players on every single team — ${capacity} players total across all teams.
${players.length > capacity
  ? `The roster has ${players.length} players, which is more than the ${capacity} available slots. Choose the best ${capacity} players (balanced across teams by ranking) and put the remaining ${players.length - capacity} player ID(s) that don't fit into the top-level "unassigned" array. Do NOT stretch any team beyond ${teamBuilderConstraints.teamSize} players to avoid leaving someone unassigned — leftover players belong in "unassigned", never on a team.`
  : `The roster has exactly ${players.length} players, which fits within the ${capacity} slots, so assign every player to a team and leave "unassigned" as an empty array.`}`
        : `HARD CONSTRAINT: The roster has exactly ${players.length} players. Every single one of these ${players.length} player IDs must appear in exactly one team's "players" array — no duplicates, none missing. Leave "unassigned" as an empty array.`;

      prompt = `Act as a professional sports coach and team builder. I have a roster of athletes and their evaluation rankings.
I need you to divide them into balanced teams based on my instructions.

User Instructions:
"${userPrompt || 'Build balanced teams based on the players overall ratings.'}"

Roster:
${players.map((p: any) => `- ID: ${p.id} | Name: ${p.first} ${p.last} | Pos: ${p.pos || 'N/A'} | YOB: ${p.yearOfBirth || 'N/A'} | Friends: ${[p.friend1Name, p.friend2Name].filter(Boolean).join(', ') || 'None'}`).join('\n')}

Rankings (weighted overall score 1-5 and per-category averages per athlete; overall of 0 means not yet evaluated):
${JSON.stringify(rankings, null, 2)}

${assignmentInstruction}
DO NOT hallucinate IDs — every player ID used anywhere in the response (in a team or in "unassigned") must come from the Roster list above.
Return exactly this JSON format:
{
  "explanation": "A 2-3 sentence explanation of how you split the teams and satisfied the instructions. NEVER include player IDs here.",
  "warnings": ["Any warnings, e.g. goalies are unbalanced. If none, empty array."],
  "unassigned": ["player_id_left_over"],
  "teams": [
    {
      "name": "Team A",
      "players": ["player_id_1", "player_id_2"]
    }
  ]
}
Do NOT include "skaters" or "goalies" fields — list every player once in "players" only; positions are looked up separately.
Every player ID in the roster must appear exactly once total — either in exactly one team's "players" array, or in the top-level "unassigned" array, never in both and never omitted.`;
    } else {
      throw new Error('Invalid action. Must be "summary", "compare", or "team_builder"');
    }

    let parsedResult = await callClaudeForJson(systemPrompt, prompt, maxTokens);

    if (action === 'team_builder') {
      // Repair small mistakes (duplicate/hallucinated/dropped IDs) deterministically
      // before validating — these are common on large rosters and don't need the
      // model to try again. Only numeric constraint violations (wrong team count/
      // size) fall through to a real corrective retry, since those need the model
      // to actually reconsider the split.
      parsedResult = reconcileTeamBuilderResult(parsedResult, teamBuilderPlayers);
      let issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints);
      if (issues.length > 0) {
        const correctivePrompt = `${prompt}\n\nYour previous attempt was rejected for these reasons:\n${issues.map((i: string) => `- ${i}`).join('\n')}\nFix these issues exactly and return corrected JSON in the same format.`;
        parsedResult = await callClaudeForJson(systemPrompt, correctivePrompt, maxTokens);
        parsedResult = reconcileTeamBuilderResult(parsedResult, teamBuilderPlayers);
        issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints);
        if (issues.length > 0) {
          throw new Error(`The AI couldn't satisfy your instructions (${issues.join('; ')}). Please try again or simplify your instructions.`);
        }
      }
    }

    // Persist the AI result to DB using the service role key (bypasses RLS),
    // so all user roles (owner, coach, assessor) see the summary on next load.
    if (action === 'summary' && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const playerId = playerIds[0];
        // Fetch current ai_assessments, merge in the new summary, then update.
        const { data: row } = await adminClient
          .from('tryouts')
          .select('ai_assessments')
          .eq('id', tryout.id)
          .single();
        const current = row?.ai_assessments ?? {};
        await adminClient
          .from('tryouts')
          .update({ ai_assessments: { ...current, [playerId]: parsedResult } })
          .eq('id', tryout.id);
      } catch (dbErr) {
        // Non-fatal — the client still receives the summary even if the DB save fails.
        console.warn('Could not persist AI summary to DB:', dbErr);
      }
    }

    return new Response(JSON.stringify(parsedResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error generating AI insights:', error);
    // Return 200 so Supabase's invoke() places the body in `data` (not `error`),
    // preventing the "Cannot coerce the result to a single JSON object" client error.
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
