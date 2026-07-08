// @ts-nocheck
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const { action, tryout, playerIds } = await req.json();

    if (!action || !tryout || !playerIds || playerIds.length === 0) {
      throw new Error('Missing required fields: action, tryout, or playerIds');
    }

    let prompt = '';
    let systemPrompt = 'You are an expert sports scout and analyst assessing athletes at a tryout. Keep responses concise, objective, and professional.';

    if (action === 'summary') {
      const playerId = playerIds[0];
      const player = tryout.roster.find((p: any) => p.id === playerId);
      const evals = tryout.evals.filter((e: any) => e.playerId === playerId);
      
      prompt = `
      Please provide a comprehensive summary for athlete ${player?.first} ${player?.last} (Position: ${player?.pos || 'N/A'}).
      They have received ${evals.length} evaluations so far.
      
      Evaluation Data:
      ${JSON.stringify(evals, null, 2)}
      
      Please return a JSON object with the following structure exactly (no markdown formatting, just pure JSON):
      {
        "summary": "A 1-2 sentence overall summary of their performance.",
        "key_strengths": ["strength 1", "strength 2"],
        "key_growth": ["area for improvement 1", "area for improvement 2"],
        "role_fit": "Proposed role (e.g., Starting forward, Depth player)",
        "confidence": 0.85,
        "trend": "improving" | "steady" | "declining" | "insufficient_data"
      }
      `;
    } else if (action === 'compare') {
      const players = tryout.roster.filter((p: any) => playerIds.includes(p.id));
      const evals = tryout.evals.filter((e: any) => playerIds.includes(e.playerId));
      
      prompt = `
      Please provide a comparison of the following athletes:
      ${players.map((p: any) => `- ${p.first} ${p.last} (Pos: ${p.pos || 'N/A'})`).join('\n')}
      
      Here are all their evaluations combined:
      ${JSON.stringify(evals, null, 2)}
      
      Please return a JSON object with the following structure exactly (no markdown formatting, just pure JSON):
      {
        "summary": "A 1-2 sentence summary comparing the athletes.",
        "edge": "Which athlete has the slight edge and why.",
        "best_fit": "Name of the athlete who is the best fit overall.",
        "watch_list": ["Athlete Name 1", "Athlete Name 2"],
        "recommendation": "Final recommendation for the coaching staff."
      }
      `;
    } else {
      throw new Error('Invalid action. Must be "summary" or "compare"');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${data.error?.message || JSON.stringify(data)}`);
    }

    const content = data.choices[0].message.content;
    const parsedResult = JSON.parse(content);

    return new Response(JSON.stringify(parsedResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error generating AI insights:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
