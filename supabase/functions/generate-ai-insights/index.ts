// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }

    const { action, tryout, playerIds } = await req.json();

    if (!action || !tryout || !playerIds || playerIds.length === 0) {
      throw new Error('Missing required fields: action, tryout, or playerIds');
    }

    let prompt = '';
    const systemPrompt = `You are a professional sports scout AI. Your ONLY job is to analyze the numeric evaluation data provided to you from an athlete assessment app database. 
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
    } else {
      throw new Error('Invalid action. Must be "summary" or "compare"');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${data.error?.message || JSON.stringify(data)}`);
    }

    const content = data.content[0].text;
    // Strip markdown code fences that Claude sometimes adds (e.g. ```json ... ```)
    // Also handle cases where there's text before/after the JSON block
    let cleaned = content.trim();
    // Remove leading ```json or ``` fences
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    // Remove trailing ``` fences
    cleaned = cleaned.replace(/\s*```\s*$/i, '').trim();
    // If there's still no valid start, find the first { or [
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
      const jsonStart = cleaned.search(/[{[]/);
      if (jsonStart !== -1) cleaned = cleaned.slice(jsonStart);
    }
    // Trim trailing content after the last } or ]
    const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (lastBrace !== -1 && lastBrace < cleaned.length - 1) {
      cleaned = cleaned.slice(0, lastBrace + 1);
    }
    const parsedResult = JSON.parse(cleaned);

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
