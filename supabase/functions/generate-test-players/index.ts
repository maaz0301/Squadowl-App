// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

// Bulk-generate realistic dummy player profiles (identity + scores) for the
// association-only "Testing Tools". The DataSource passes a single chunk
// (sport, count, allowed positions, and the assessment's rubric definitions);
// this returns a JSON array of players with a raw score for every rubric so the
// scoring/ranking pipeline can be exercised end-to-end. Kept small and stateless
// — the DataSource orchestrates chunking, validation, and DB persistence.
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }

    const { sport, count, positions, rubrics } = await req.json();

    if (!sport || !count || !Array.isArray(positions) || !Array.isArray(rubrics)) {
      throw new Error('Missing required fields: sport, count, positions, rubrics');
    }

    // Describe each rubric so the model emits raw values in the correct units.
    const rubricLines = rubrics
      .map((r: any) => {
        const key = r.key;
        const type = r.scoringType ?? 'skill';
        if (type === 'skill') {
          const max = r.scale === '1-10' ? 10 : 5;
          return `- "${key}" (${r.label ?? key}): skill rating, integer 1-${max}, higher is better.`;
        }
        if (type === 'time') {
          const best = r.minVal ?? 4.5;
          const worst = r.maxVal ?? 7.5;
          return `- "${key}" (${r.label ?? key}): timed result in seconds, ${best} (fastest/best) to ${worst} (slowest/worst), LOWER is better.`;
        }
        // distance / speed
        const worst = r.minVal ?? 8;
        const best = r.maxVal ?? 40;
        return `- "${key}" (${r.label ?? key}): ${type} measurement, ${worst} (worst) to ${best} (best), HIGHER is better.`;
      })
      .join('\n');

    const systemPrompt = `You generate realistic but entirely fictional dummy athlete profiles for load-testing a sports assessment app. You never use real people. You respond with pure JSON only — no markdown, no code fences, no commentary.`;

    const prompt = `Generate exactly ${count} fictional ${sport} players for test data.

For each player produce:
- firstName, lastName: varied, realistic, culturally diverse first/last names.
- position: choose ONE from this list (weighted toward common positions): ${JSON.stringify(positions)}.
- age: integer 8-18.
- level: one of "AAA", "AA", "A", "BB", "House".
- bio: one short scouting sentence (max 15 words).
- ability: a number 0.0-1.0 representing overall talent. Spread abilities realistically across the batch (a few stars, many average, some weak).
- recommendation: based on ability — >0.75 "Make", >0.5 "Keep", >0.3 "Bubble", else "Release".
- scores: an object with a raw score for EVERY rubric key below. A player's scores MUST correlate with their ability (high-ability players score better on every metric, respecting each metric's direction), with small realistic variation between metrics.

Rubrics to score (respect the exact units and direction):
${rubricLines}

Return ONLY this JSON shape:
{"players":[{"firstName":"...","lastName":"...","position":"...","age":12,"level":"AA","bio":"...","ability":0.62,"recommendation":"Keep","scores":{"<rubricKey>":<number>}}]}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        temperature: 1,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${data.error?.message || JSON.stringify(data)}`);
    }

    const content = data.content[0].text;
    // Strip markdown code fences / stray text, same as generate-ai-insights.
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
    const parsed = JSON.parse(cleaned);
    const players = Array.isArray(parsed) ? parsed : parsed.players ?? [];

    return new Response(JSON.stringify({ players }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error generating test players:', error);
    // Return 200 so Supabase's invoke() places the body in `data`, letting the
    // DataSource detect the error and fall back to local generation.
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});
