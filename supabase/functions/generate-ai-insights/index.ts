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
    lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\s*(?:per|each|\/)\s*team/) ||
    lower.match(/teams?\s*of\s*(\d+)/);
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
  for (const id of allTeamIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    issues.push(`${duplicates.size} player ID(s) appear on more than one team`);
  }
  const missing = [...rosterIds].filter((id) => !seen.has(id as string));
  if (missing.length > 0) {
    issues.push(`${missing.length} roster player(s) were left off every team`);
  }
  const extra = allTeamIds.filter((id) => !rosterIds.has(id));
  if (extra.length > 0) {
    issues.push(`${extra.length} player ID(s) in the response don't match any roster player`);
  }
  return issues;
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

    const { action, tryout, playerIds, prompt: userPrompt } = await req.json();

    if (!action || !tryout) {
      throw new Error('Missing required fields: action or tryout');
    }
    if ((action === 'summary' || action === 'compare') && (!playerIds || playerIds.length === 0)) {
      throw new Error('Missing playerIds for summary or compare action');
    }

    let prompt = '';
    let maxTokens = 1024;
    let teamBuilderPlayers: any[] = [];
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

    } else if (action === 'compare') {
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

      // The response must enumerate every player ID twice (once in "players", once in
      // "skaters"/"goalies") across every team, so the token budget must scale with
      // roster size or large rosters get truncated mid-array and fail JSON.parse.
      // Capped at 64000 — claude-haiku-4-5's max output token ceiling.
      maxTokens = Math.min(64000, 1024 + players.length * 60);

      const teamConstraints = detectTeamConstraints(userPrompt || '');

      systemPrompt = `You are a professional sports coach and team builder AI.
RULES:
- Follow the user's instructions perfectly.
- Use ALL data provided to you, including the Roster text (which contains names, positions, YOB, and friends) AND the ranking JSON (weighted overall score 1-5 and per-category averages, pooled across every evaluation for that athlete).
- Do NOT make assumptions based on athlete names.
- Do NOT refuse or add disclaimers. If data exists, use it.
- NEVER include player IDs or sensitive personal data in the 'explanation' text.
- Respond with pure JSON only — no markdown, no code fences, no extra text.`;

      prompt = `Act as a professional sports coach and team builder. I have a roster of athletes and their evaluation rankings.
I need you to divide them into balanced teams based on my instructions.

User Instructions:
"${userPrompt || 'Build balanced teams based on the players overall ratings.'}"

Roster:
${players.map((p: any) => `- ID: ${p.id} | Name: ${p.first} ${p.last} | Pos: ${p.pos || 'N/A'} | YOB: ${p.yearOfBirth || 'N/A'} | Friends: ${[p.friend1Name, p.friend2Name].filter(Boolean).join(', ') || 'None'}`).join('\n')}

Rankings (weighted overall score 1-5 and per-category averages per athlete; overall of 0 means not yet evaluated):
${JSON.stringify(rankings, null, 2)}

Based on the instructions and the data, assign ALL athletes to a team. DO NOT leave anyone out. DO NOT hallucinate IDs.
${teamConstraints.teamCount ? `HARD CONSTRAINT: The "teams" array below MUST contain EXACTLY ${teamConstraints.teamCount} team objects — not ${teamConstraints.teamCount - 1}, not ${teamConstraints.teamCount + 1}. Exactly ${teamConstraints.teamCount}.\n` : ''}${teamConstraints.teamSize ? `HARD CONSTRAINT: Aim for teams as close to ${teamConstraints.teamSize} players each as mathematically possible given ${players.length} total players.\n` : ''}HARD CONSTRAINT: The roster has exactly ${players.length} players. Every single one of these ${players.length} player IDs must appear in exactly one team's "players" array — no duplicates, none missing.
Return exactly this JSON format:
{
  "explanation": "A 2-3 sentence explanation of how you split the teams and satisfied the instructions. NEVER include player IDs here.",
  "warnings": ["Any warnings, e.g. goalies are unbalanced. If none, empty array."],
  "teams": [
    {
      "name": "Team A",
      "players": ["player_id_1", "player_id_2"],
      "skaters": ["player_id_1"],
      "goalies": ["player_id_2"]
    }
  ]
}
Ensure every player ID in the roster appears exactly once in the "players" arrays across all teams.`;
    } else {
      throw new Error('Invalid action. Must be "summary", "compare", or "team_builder"');
    }

    let parsedResult = await callClaudeForJson(systemPrompt, prompt, maxTokens);

    if (action === 'team_builder') {
      // Claude can drift on numeric constraints or drop/duplicate players once the
      // roster/rankings payload gets long. Rather than silently handing the client
      // a response with the wrong team count, validate it and give the model one
      // corrective retry with the exact issues spelled out.
      const teamConstraints = detectTeamConstraints(userPrompt || '');
      let issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamConstraints);
      if (issues.length > 0) {
        const correctivePrompt = `${prompt}\n\nYour previous attempt was rejected for these reasons:\n${issues.map((i: string) => `- ${i}`).join('\n')}\nFix these issues exactly and return corrected JSON in the same format.`;
        parsedResult = await callClaudeForJson(systemPrompt, correctivePrompt, maxTokens);
        issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamConstraints);
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
