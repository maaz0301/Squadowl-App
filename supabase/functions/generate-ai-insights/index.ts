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
function detectTeamConstraints(text: string, totalPlayers?: number): { teamCount?: number; teamSize?: number } {
  const lower = (text || '').toLowerCase();
  const countMatch = lower.match(/(\d+)\s*teams?\b/);
  const sizeMatch =
    lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\b(?:\s+\w+){0,2}?\s*team/) ||
    lower.match(/teams?\s*of\s*(\d+)/) ||
    // Fallback for phrasing like "5 players each"/"5 athletes per" where "team"
    // isn't repeated near the size (it was already said earlier, e.g. "2 teams
    // ... 5 players each for the hockey").
    lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\s*(?:each|per|apiece)\b/) ||
    // Last-resort fallback for phrasing with no "team"/"each"/"per" anchor at all,
    // e.g. "strictly have 10 players". Skipped when the number equals the total
    // roster size, since that's almost always a mention of the whole roster
    // ("I have 150 players") rather than a per-team size.
    (() => {
      const m = lower.match(/(\d+)\s*(?:players?|athletes?|kids?|skaters?|people)\b/);
      if (m && totalPlayers !== undefined && parseInt(m[1], 10) === totalPlayers) return null;
      return m;
    })();
  return {
    teamCount: countMatch ? parseInt(countMatch[1], 10) : undefined,
    teamSize: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
  };
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

// Detects a per-position cap in the user's instructions ("not more than one
// goalie per team"). Used only to explain, in "warnings", when the roster simply
// has too many players of a position for that cap to be possible — the split
// itself always spreads positions as evenly as it can rather than silently
// leaving the surplus players out.
function detectPositionCap(text: string): number | undefined {
  const m = (text || '').toLowerCase().match(/(?:no|not)\s+more\s+than\s+(?:a\s+)?(\d+|one|two|three|four|five)\b/);
  if (!m) return undefined;
  return /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUMBERS[m[1]];
}

const GOALIE_WORDS = ['goalie', 'goaltender', 'goalkeeper', 'keeper', 'netminder'];
const GOALIE_CODES = new Set(['G', 'GK', 'GL', 'GTL', 'GOALIE', 'GOALKEEPER', 'GOALTENDER']);

// Words that mean the same position across the sports this app supports, so a
// request phrased in one vocabulary ("10 strikers") lands on a roster that spells
// the position another way ("FWD"). A roster position belongs to a family when
// its own label appears in the family, so matching works in both directions.
const POSITION_FAMILIES: string[][] = [
  [...GOALIE_WORDS, 'gtl', 'gk', 'gl', 'g'],
  ['forward', 'fwd', 'fw', 'striker', 'attacker', 'attack', 'winger', 'wing', 'lw', 'rw', 'offense', 'offence'],
  ['defense', 'defence', 'defender', 'defenseman', 'defensemen', 'defenceman', 'defencemen', 'def', 'd', 'back', 'fullback', 'blueliner'],
  ['midfield', 'midfielder', 'mid', 'mf'],
  ['guard', 'pg', 'sg'],
  ['center', 'centre', 'c'],
  ['pitcher'],
  ['catcher'],
  ['infield', 'infielder'],
  ['outfield', 'outfielder'],
];

// Maps a word from the user's instructions onto the position labels this roster
// actually uses. Returns every matching label (e.g. "guards" -> PG and SG), or an
// empty array when the word means nothing on this roster.
function resolvePositionLabel(label: string, rosterPositions: string[]): string[] {
  const l = label.trim().toLowerCase().replace(/s$/, '');
  if (!l) return [];
  const exact = rosterPositions.filter((p) => p.toLowerCase().replace(/s$/, '') === l);
  if (exact.length) return exact;
  const family = POSITION_FAMILIES.find((f) => f.includes(l));
  if (family) {
    const byFamily = rosterPositions.filter((p) => family.includes(p.toLowerCase().replace(/s$/, '')));
    if (byFamily.length) return byFamily;
  }
  // Last resort: a prefix match, which catches "defensemen" against a roster that
  // spells it "Defense". Two characters minimum so a stray letter can't match.
  if (l.length < 2) return [];
  return rosterPositions.filter((p) => {
    const pl = p.toLowerCase();
    return pl.length >= 2 && (pl.startsWith(l) || l.startsWith(pl));
  });
}

// Pulls a per-team position composition out of the user's free text — "4 teams of
// 11 players with 10 strikers and 1 goalie" -> 10 FWD + 1 GTL on every team. Only
// number/word pairs that resolve to a position this roster actually uses are kept,
// so "4 teams" and "11 players" are ignored without needing a stop-word list. Words
// that look like a position request but match nothing are returned separately so the
// user can be told why that part of their instruction wasn't applied.
function detectPositionQuotas(
  text: string,
  rosterPositions: string[],
): { quotas: Map<string, number>; unmatched: string[] } {
  const quotas = new Map<string, number>();
  const unmatched: string[] = [];
  const re = /(\d+|one|two|three|four|five)\s+([a-z][a-z']*)/g;
  const lower = (text || '').toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const count = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUMBERS[m[1]];
    const label = m[2];
    if (!Number.isFinite(count) || count < 0) continue;
    // "no more than 1 goalie" is a ceiling and "at least 2" a floor — neither is a
    // count to hit exactly. Bounds are handled by the position-cap path instead, so
    // a roster with too few goalies isn't forced to bench the ones it has.
    if (/(?:no|not)\s+more\s+than\s+(?:a\s+)?$|at\s+(?:most|least)\s+$|up\s+to\s+$|max(?:imum)?\s+(?:of\s+)?$|min(?:imum)?\s+(?:of\s+)?$|fewer\s+than\s+$|less\s+than\s+$|more\s+than\s+$/.test(lower.slice(0, m.index))) {
      continue;
    }
    const positions = resolvePositionLabel(label, rosterPositions);
    if (!positions.length) {
      // Only worth reporting when the word could plausibly have been a position —
      // "4 teams"/"11 players" are structural, not a composition request.
      if (!/^(team|teams|player|players|athlete|athletes|kid|kids|people|person|year|years|game|games|group|groups|total|each|per|of|the|with|and)$/.test(label)) {
        unmatched.push(`${count} ${label}`);
      }
      continue;
    }
    // Spread the requested count across the labels it matched (largest remainder),
    // so "4 guards" on a roster with PG and SG becomes 2 PG + 2 SG.
    const base = Math.floor(count / positions.length);
    let rest = count - base * positions.length;
    for (const pos of positions) {
      quotas.set(pos, (quotas.get(pos) ?? 0) + base + (rest-- > 0 ? 1 : 0));
    }
  }
  return { quotas, unmatched };
}

// A cap like "no more than one goalie per team" is about the specific position the
// user named, not every position on the roster — warning that 90 forwards exceed a
// "1 per team" cap would be nonsense noise.
function promptMentionsPosition(lowerPrompt: string, pos: string): boolean {
  if (GOALIE_CODES.has(pos) && GOALIE_WORDS.some((w) => lowerPrompt.includes(w))) return true;
  return new RegExp(`\\b${pos.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(lowerPrompt);
}

// Explains a position cap the roster simply can't satisfy, using the final split's
// own numbers so the warning matches what's on screen.
function positionCapWarnings(teams: any[], players: any[], cap: number | undefined, userPrompt: string): string[] {
  if (!cap || teams.length === 0) return [];
  const lowerPrompt = (userPrompt || '').toLowerCase();
  const posById = new Map(players.map((p: any) => [p.id, normalizePos(p.pos)]));
  const totalByPos = new Map<string, number>();
  for (const t of teams) {
    for (const id of t.players || []) {
      const pos = posById.get(id) ?? 'N/A';
      totalByPos.set(pos, (totalByPos.get(pos) ?? 0) + 1);
    }
  }
  const warnings: string[] = [];
  for (const [pos, total] of totalByPos) {
    if (pos === 'N/A' || total <= cap * teams.length) continue;
    if (!promptMentionsPosition(lowerPrompt, pos)) continue;
    warnings.push(
      `You asked for no more than ${cap} ${pos} per team, but the roster has ${total} ${pos} players across ${teams.length} teams — only ${cap * teams.length} fit at that cap. They were spread as evenly as possible (about ${Math.ceil(total / teams.length)} per team) instead of leaving ${total - cap * teams.length} players off a team.`,
    );
  }
  return warnings;
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
  } else if (!constraints.teamSize && teams.length > 0) {
    // No explicit per-team size was given, so every player belongs on a team and
    // sizes should come out as even as the roster allows (differ by at most 1).
    // Catches cases like a position cap ("no more than 1 goalie per team") causing
    // the model to dump every leftover player onto one lopsided team, or to leave
    // a stray player off entirely, instead of spreading them out.
    const sizes = teams.map((t: any) => (t?.players || []).length);
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    if (max - min > 1) {
      issues.push(`teams are unevenly sized (${sizes.join(', ')}) — with ${players.length} players across ${teams.length} teams and no exact per-team size requested, every team must have as close to ${Math.floor(players.length / teams.length)}-${Math.ceil(players.length / teams.length)} players as possible; do not dump leftover players (e.g. extra players of one position) onto a single small team`);
    }
    if (unassigned.length > 0) {
      issues.push(`"unassigned" must be empty — no exact per-team size was requested, so all ${players.length} players must be placed on a team`);
    }
  }

  return issues;
}

const normalizePos = (pos: any) => (pos ? String(pos) : 'N/A').trim().toUpperCase() || 'N/A';

// Spreads every position evenly across teams using size-preserving swaps, so a
// position cap in the user's instructions (e.g. "no more than 1 goalie per team")
// can't be "satisfied" by piling every surplus player of that position onto one
// team. Asking the model nicely is not enough on a large roster — it repeatedly
// dumped 20 goalies onto a single team — so the split is corrected here instead
// of burning a slow full-roster retry. Swap partners are chosen by closest
// overall rating so the model's skill balancing survives the rebalance.
function balanceTeamPositions(teams: any[], players: any[], scoreById: Map<string, number>): void {
  const teamCount = teams.length;
  if (teamCount < 2) return;

  const posById = new Map(players.map((p: any) => [p.id, normalizePos(p.pos)]));
  const posOf = (id: string) => posById.get(id) ?? 'N/A';
  const scoreOf = (id: string) => scoreById.get(id) ?? 0;

  const totalByPos = new Map<string, number>();
  const counts = teams.map(() => new Map<string, number>());
  teams.forEach((t: any, i: number) => {
    for (const id of t.players) {
      const pos = posOf(id);
      totalByPos.set(pos, (totalByPos.get(pos) ?? 0) + 1);
      counts[i].set(pos, (counts[i].get(pos) ?? 0) + 1);
    }
  });

  const cnt = (ti: number, pos: string) => counts[ti].get(pos) ?? 0;

  const move = (from: number, to: number, id: string) => {
    const pos = posOf(id);
    teams[from].players = teams[from].players.filter((x: string) => x !== id);
    teams[to].players.push(id);
    counts[from].set(pos, cnt(from, pos) - 1);
    counts[to].set(pos, cnt(to, pos) + 1);
  };

  // Every accepted swap strictly lowers the sum of squared per-team position
  // counts, so this always terminates; the iteration cap is only a safety net.
  for (let iter = 0; iter < 10000; iter++) {
    let swapped = false;
    for (const pos of totalByPos.keys()) {
      // Move from the team holding the most of this position to the team holding
      // the fewest. Comparing each team against the floor/ceiling instead missed
      // the common lopsided-but-legal case: 6 goalies split 3/1/1/1 across 4
      // teams has nobody below the floor of 1, so nothing ever moved and one
      // team kept all three.
      let over = 0;
      let under = 0;
      counts.forEach((_, i) => {
        if (cnt(i, pos) > cnt(over, pos)) over = i;
        if (cnt(i, pos) < cnt(under, pos)) under = i;
      });
      if (cnt(over, pos) - cnt(under, pos) < 2) continue;

      const giveId = teams[over].players.find((id: string) => posOf(id) === pos);
      if (!giveId) continue;
      // Take back a player whose own position spread improves at least as much
      // as `pos` improves, so the swap can't just relocate the imbalance onto
      // another position (or ping-pong two positions back and forth forever).
      const gainAt = cnt(over, pos) - cnt(under, pos) - 1;
      const candidates = teams[under].players.filter((id: string) => {
        const q = posOf(id);
        return q !== pos && cnt(over, q) - cnt(under, q) + 1 < gainAt;
      });
      if (!candidates.length) continue;
      const target = scoreOf(giveId);
      const takeId = candidates.reduce((best: string, id: string) =>
        Math.abs(scoreOf(id) - target) < Math.abs(scoreOf(best) - target) ? id : best,
      );

      move(over, under, giveId);
      move(under, over, takeId);
      swapped = true;
    }
    if (!swapped) break;
  }
}

// How many players of each position every team should carry. Used only when the
// roster is bigger than the requested capacity, so there is a pool of unassigned
// players to trade with. Largest-remainder allocation over the positions the
// model actually picked, capped by what the roster can supply and by any
// explicit per-position cap in the user's instructions, so the counts sum to the
// team size exactly and every team ends up with the same position mix.
function targetCompositionPerTeam(
  assigned: Map<string, number>,
  poolByPos: Map<string, string[]>,
  teamCount: number,
  teamSize: number,
  positionCap: number | undefined,
  userPrompt: string,
  quotas: Map<string, number> = new Map(),
): Map<string, number> {
  const lowerPrompt = (userPrompt || '').toLowerCase();
  const capFor = (pos: string) =>
    positionCap != null && promptMentionsPosition(lowerPrompt, pos) ? positionCap : Infinity;
  const availFor = (pos: string) => (assigned.get(pos) ?? 0) + (poolByPos.get(pos)?.length ?? 0);

  const target = new Map<string, number>();
  let used = 0;

  // A position the user asked for by name is pinned to that count. A count the
  // roster can't supply for every team is left unpinned instead of clamped — those
  // players are better spread across the teams than traded away to satisfy a number
  // that was never reachable (the shortfall is reported in "warnings").
  const pinned = new Map<string, number>();
  for (const [pos, want] of quotas) {
    if (want * teamCount > availFor(pos)) continue;
    const n = Math.max(0, Math.min(want, capFor(pos)));
    pinned.set(pos, n);
    target.set(pos, n);
    used += n;
  }
  // Requested counts that add up to more than a team holds: drop from the largest
  // request first, so a small explicit ask ("1 goalie") survives intact.
  while (used > teamSize) {
    const biggest = [...target.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!biggest || biggest[1] === 0) break;
    target.set(biggest[0], biggest[1] - 1);
    used--;
  }

  for (const [pos, total] of assigned) {
    if (target.has(pos)) continue;
    const even = Math.floor(total / teamCount);
    // A position too scarce to reach every team still belongs on the teams that do
    // have it: targeting 0 would trade the roster's only goalies back to the pool
    // and leave no team with the role at all.
    const wanted = even === 0 && total > 0 ? 1 : even;
    const base = Math.min(wanted, capFor(pos), Math.max(0, teamSize - used));
    target.set(pos, base);
    used += base;
  }

  // Hand the leftover seats to the positions with the largest fractional
  // remainder; ties go to the position with more players, so a scarce position
  // (goalies) rounds down rather than doubling up on every team.
  // Positions the model didn't pick at all are still candidates, since the leftover
  // seats can be filled straight from the pool of unassigned players.
  const candidatePositions = new Set([...assigned.keys(), ...poolByPos.keys()]);
  const order = [...candidatePositions]
    .map((pos) => {
      const total = assigned.get(pos) ?? 0;
      return { pos, total, frac: (total % teamCount) / teamCount };
    })
    .sort((a, b) => b.frac - a.frac || b.total - a.total);
  let seats = teamSize - used;
  while (seats > 0) {
    let progressed = false;
    for (const { pos } of order) {
      if (seats <= 0) break;
      if (pinned.has(pos)) continue;
      const next = (target.get(pos) ?? 0) + 1;
      if (next > capFor(pos) || next * teamCount > availFor(pos)) continue;
      target.set(pos, next);
      seats--;
      progressed = true;
    }
    if (!progressed) break;
  }
  return target;
}

// When the roster is larger than the requested capacity, an uneven position
// split doesn't have to be tolerated — the surplus can be traded back to the
// pool of unassigned players. Without this, a selection of 6 goalies across 4
// teams of 11 can at best be spread 2/2/1/1 by swapping within the teams; here
// the 2 extra goalies go back to the pool and 2 skaters come in, so every team
// gets exactly 1. Swaps are 1-for-1, so team sizes and the unassigned count are
// unchanged and the response still satisfies the requested team size.
function rebalanceAgainstPool(
  teams: any[],
  unassigned: string[],
  players: any[],
  scoreById: Map<string, number>,
  positionCap: number | undefined,
  userPrompt: string,
  quotas: Map<string, number> = new Map(),
): void {
  const teamCount = teams.length;
  if (teamCount < 2 || unassigned.length === 0) return;
  const teamSize = teams[0].players.length;
  if (teams.some((t: any) => t.players.length !== teamSize)) return;

  const posById = new Map(players.map((p: any) => [p.id, normalizePos(p.pos)]));
  const posOf = (id: string) => posById.get(id) ?? 'N/A';
  const scoreOf = (id: string) => scoreById.get(id) ?? 0;

  const assigned = new Map<string, number>();
  for (const t of teams) {
    for (const id of t.players) assigned.set(posOf(id), (assigned.get(posOf(id)) ?? 0) + 1);
  }
  const poolByPos = new Map<string, string[]>();
  for (const id of unassigned) {
    const pos = posOf(id);
    if (!poolByPos.has(pos)) poolByPos.set(pos, []);
    poolByPos.get(pos)!.push(id);
  }
  // Best-rated first, so a player traded in is the strongest one available.
  for (const list of poolByPos.values()) list.sort((a, b) => scoreOf(b) - scoreOf(a));

  const target = targetCompositionPerTeam(assigned, poolByPos, teamCount, teamSize, positionCap, userPrompt, quotas);

  for (const pos of [...new Set([...assigned.keys(), ...target.keys()])]) {
    let surplus = (assigned.get(pos) ?? 0) - (target.get(pos) ?? 0) * teamCount;
    while (surplus > 0) {
      const needPos = [...target.keys()].find(
        (q) =>
          q !== pos &&
          (assigned.get(q) ?? 0) < (target.get(q) ?? 0) * teamCount &&
          (poolByPos.get(q)?.length ?? 0) > 0,
      );
      if (!needPos) break;

      // Take the surplus off whichever team is carrying the most of it, dropping
      // that team's lowest-rated one so the model's best picks stay on a team.
      let from = 0;
      let fromCount = -1;
      teams.forEach((t: any, i: number) => {
        const n = t.players.filter((id: string) => posOf(id) === pos).length;
        if (n > fromCount) { from = i; fromCount = n; }
      });
      const held = teams[from].players.filter((id: string) => posOf(id) === pos);
      if (!held.length) break;
      const outId = held.reduce((worst: string, id: string) => (scoreOf(id) < scoreOf(worst) ? id : worst));
      const inId = poolByPos.get(needPos)!.shift()!;

      teams[from].players = teams[from].players.filter((id: string) => id !== outId);
      teams[from].players.push(inId);
      unassigned.splice(unassigned.indexOf(inId), 1);
      unassigned.push(outId);
      assigned.set(pos, (assigned.get(pos) ?? 0) - 1);
      assigned.set(needPos, (assigned.get(needPos) ?? 0) + 1);
      surplus--;
    }
  }
}

// Deterministically repairs the common near-miss mistakes Claude makes on large
// rosters — a stray duplicated ID, a hallucinated ID, a player dropped entirely —
// instead of rejecting the whole response and burning a retry (and more latency)
// on an otherwise-good team split. Every roster ID ends up on exactly one team
// (first team it was seen on, preserving the model's placement intent) or in
// "unassigned" if it was never validly placed. The team count is NOT something
// this can safely patch, so validateTeamBuilderResult still runs afterward to
// catch that and trigger a real corrective retry.
function reconcileTeamBuilderResult(
  result: any,
  players: any[],
  constraints: { teamCount?: number; teamSize?: number } = {},
  scoreById: Map<string, number> = new Map(),
  opts: { positionCap?: number; userPrompt?: string; quotas?: Map<string, number> } = {},
): any {
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

  let unassigned = rosterIds.filter((id) => !assigned.has(id));

  if (cleanedTeams.length > 0) {
    // Players the model dropped only belong in "unassigned" when a hard per-team
    // size was requested and every seat is genuinely taken. Otherwise seat them on
    // the smallest team — leaving someone off a 150-player split because the model
    // forgot them is never the intended outcome.
    const cap = constraints.teamSize ?? Infinity;
    const stillUnassigned: string[] = [];
    for (const id of unassigned) {
      let best = -1;
      for (let i = 0; i < cleanedTeams.length; i++) {
        if (cleanedTeams[i].players.length >= cap) continue;
        if (best < 0 || cleanedTeams[i].players.length < cleanedTeams[best].players.length) best = i;
      }
      if (best < 0) stillUnassigned.push(id);
      else cleanedTeams[best].players.push(id);
    }
    unassigned = stillUnassigned;

    // With no exact per-team size requested every player is assigned, so sizes
    // should land within one of each other rather than leaving a stub team.
    if (constraints.teamSize === undefined) {
      for (let guard = 0; guard < 10000; guard++) {
        let maxI = 0;
        let minI = 0;
        cleanedTeams.forEach((t: any, i: number) => {
          if (t.players.length > cleanedTeams[maxI].players.length) maxI = i;
          if (t.players.length < cleanedTeams[minI].players.length) minI = i;
        });
        if (cleanedTeams[maxI].players.length - cleanedTeams[minI].players.length <= 1) break;
        cleanedTeams[minI].players.push(cleanedTeams[maxI].players.pop());
      }
    }

    // Trade any position surplus back to the unassigned pool first (only
    // possible when the roster is over capacity), then even out whatever is
    // left by swapping between the teams themselves.
    rebalanceAgainstPool(cleanedTeams, unassigned, players, scoreById, opts.positionCap, opts.userPrompt || '', opts.quotas);
    balanceTeamPositions(cleanedTeams, players, scoreById);
  }

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
    let teamBuilderScores = new Map<string, number>();
    let teamBuilderPositionCap: number | undefined;
    let teamBuilderQuotas = new Map<string, number>();
    let teamBuilderUnmatchedQuotas: string[] = [];
    let teamBuilderRosterPositions: string[] = [];
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

      // Overall rating per player, used to pick the least-disruptive partner when
      // the position rebalance has to swap two players between teams.
      teamBuilderScores = new Map(
        (rankings as any[]).map((r: any) => [r.id, typeof r.overall === 'number' ? r.overall : 0]),
      );
      teamBuilderPositionCap = detectPositionCap(userPrompt || '');

      // Per-team position composition asked for in plain language ("with 10 strikers
      // and 1 goalie"), resolved against the labels this roster actually uses. Stated
      // back to the model as a hard constraint AND enforced afterwards, since a
      // composition buried in a sentence is the instruction the model most often
      // drops on a long roster.
      const rosterPositions = [...new Set(players.map((p: any) => normalizePos(p.pos)))].filter((p) => p !== 'N/A');
      const quotaSpec = detectPositionQuotas(userPrompt || '', rosterPositions);
      teamBuilderQuotas = quotaSpec.quotas;
      teamBuilderUnmatchedQuotas = quotaSpec.unmatched;
      teamBuilderRosterPositions = rosterPositions;

      const rawConstraints = detectTeamConstraints(userPrompt || '', players.length);
      teamBuilderConstraints = {
        teamCount: rawConstraints.teamCount ?? (rawConstraints.teamSize ? Math.max(1, Math.floor(players.length / rawConstraints.teamSize)) : undefined),
        teamSize: rawConstraints.teamSize,
      };
      const capacity = teamBuilderConstraints.teamCount && teamBuilderConstraints.teamSize
        ? teamBuilderConstraints.teamCount * teamBuilderConstraints.teamSize
        : undefined;

      // The sport/game name (set when the tryout was created) tells the model what
      // "position" and "balanced" actually mean for this roster — e.g. a hockey
      // team needs its goalies spread out, a basketball team doesn't have goalies
      // at all. Without this the model has no idea what game the positions belong to.
      const sportLabel = tryout.sport === 'Other' ? (tryout.sportOther || 'Other') : tryout.sport;

      systemPrompt = `You are a professional sports coach and team builder AI.
RULES:
- Follow the user's instructions perfectly.
- This roster is for the sport: ${sportLabel || 'unspecified'}. Interpret positions, roles, and what "balanced" means in the context of this specific sport.
- Use ALL data provided to you, including the Roster text (which contains names, positions, YOB, and friends) AND the ranking JSON (weighted overall score 1-5 and per-category averages, pooled across every evaluation for that athlete).
- Balance positions across teams, not just overall skill: distribute each position (e.g. goalies/keepers, or any other position that appears) as evenly as possible across every team so no team is left short at a position, unless the user's instructions say otherwise.
- Do NOT make assumptions based on athlete names.
- Do NOT refuse or add disclaimers. If data exists, use it.
- NEVER include player IDs or sensitive personal data in the 'explanation' text.
- Respond with pure JSON only — no markdown, no code fences, no extra text.`;

      const assignmentInstruction = capacity !== undefined
        ? `HARD CONSTRAINT: Create EXACTLY ${teamBuilderConstraints.teamCount} teams with EXACTLY ${teamBuilderConstraints.teamSize} players on every single team — ${capacity} players total across all teams.
${players.length > capacity
  ? `The roster has ${players.length} players, which is more than the ${capacity} available slots. Choose the best ${capacity} players (balanced across teams by ranking) and put the remaining ${players.length - capacity} player ID(s) that don't fit into the top-level "unassigned" array. Do NOT stretch any team beyond ${teamBuilderConstraints.teamSize} players to avoid leaving someone unassigned — leftover players belong in "unassigned", never on a team.
Because you are also choosing WHICH players make a team at all, pick the mix so that all ${teamBuilderConstraints.teamCount} teams end up with the SAME position breakdown — e.g. the same number of goalies/keepers on each team. Never select more players of a position than divides evenly across ${teamBuilderConstraints.teamCount} teams: leave the extras of that position in "unassigned" and take a player of a more common position instead, rather than stacking the leftovers onto one team.`
  : `The roster has exactly ${players.length} players, which fits within the ${capacity} slots, so assign every player to a team and leave "unassigned" as an empty array.`}`
        : `HARD CONSTRAINT: The roster has exactly ${players.length} players. Every single one of these ${players.length} player IDs must appear in exactly one team's "players" array — no duplicates, none missing. Leave "unassigned" as an empty array.`;

      // Show the roster's own spelling of each position back to the model, rather
      // than the upper-cased form used for matching.
      const posDisplay = new Map(players.map((p: any) => [normalizePos(p.pos), p.pos || 'N/A']));
      const compositionInstruction = teamBuilderQuotas.size > 0
        ? `\nEXACT PER-TEAM POSITION COMPOSITION: every single team must contain exactly ${[...teamBuilderQuotas].map(([pos, n]) => `${n} player(s) whose Pos is "${posDisplay.get(pos) ?? pos}"`).join(' and ')}, filling any remaining seats on that team from the other positions. This is from the user's own instructions — hit these counts on EVERY team, not on average. Surplus players of those positions belong in "unassigned".`
        : '';

      prompt = `Act as a professional sports coach and team builder. I have a ${sportLabel || 'sports'} roster of athletes and their evaluation rankings.
I need you to divide them into balanced teams based on my instructions.

Sport/Game: ${sportLabel || 'Not specified'}

User Instructions:
"${userPrompt || 'Build balanced teams based on the players overall ratings and positions.'}"

Roster:
${players.map((p: any) => `- ID: ${p.id} | Name: ${p.first} ${p.last} | Pos: ${p.pos || 'N/A'} | YOB: ${p.yearOfBirth || 'N/A'} | Friends: ${[p.friend1Name, p.friend2Name].filter(Boolean).join(', ') || 'None'}`).join('\n')}

Rankings (weighted overall score 1-5 and per-category averages per athlete; overall of 0 means not yet evaluated):
${JSON.stringify(rankings, null, 2)}

${assignmentInstruction}${compositionInstruction}
POSITION CONSTRAINT: Every player's "Pos" above is part of this roster's ${sportLabel || 'sport'} data. When splitting teams, spread each position as evenly as possible across all teams (in addition to balancing by overall ranking) — do not stack every player of one position onto a single team unless the user's instructions explicitly say to. If a position genuinely can't be split evenly (e.g. only one goalie total), note it in "warnings".
TEAM SIZE BALANCE: Regardless of any per-position rule in the user's instructions (e.g. "no more than 1 goalie per team"), every team's total player count must stay as even as possible — differ by at most 1 player, unless an exact per-team size was given above. NEVER satisfy a position cap by dumping the extra players of that position onto one small leftover team; instead keep placing them across teams as regular roster members (filling other roles) once the position cap for a team is reached.
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
      // Repair small mistakes (duplicate/hallucinated/dropped IDs, uneven team
      // sizes, lopsided position distribution) deterministically before validating —
      // these are common on large rosters and don't need the model to try again.
      // Only the team count falls through to a real corrective retry, since that
      // needs the model to actually reconsider the split.
      parsedResult = reconcileTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints, teamBuilderScores, { positionCap: teamBuilderPositionCap, userPrompt, quotas: teamBuilderQuotas });
      let issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints);
      if (issues.length > 0) {
        const correctivePrompt = `${prompt}\n\nYour previous attempt was rejected for these reasons:\n${issues.map((i: string) => `- ${i}`).join('\n')}\nFix these issues exactly and return corrected JSON in the same format.`;
        parsedResult = await callClaudeForJson(systemPrompt, correctivePrompt, maxTokens);
        parsedResult = reconcileTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints, teamBuilderScores, { positionCap: teamBuilderPositionCap, userPrompt, quotas: teamBuilderQuotas });
        issues = validateTeamBuilderResult(parsedResult, teamBuilderPlayers, teamBuilderConstraints);
        if (issues.length > 0) {
          throw new Error(`The AI couldn't satisfy your instructions (${issues.join('; ')}). Please try again or simplify your instructions.`);
        }
      }

      // Surface any position cap the roster simply can't satisfy, using the final
      // numbers, so the user sees why e.g. a "1 goalie per team" request produced
      // several goalies per team instead of quietly dropping the surplus.
      const capWarnings = positionCapWarnings(parsedResult.teams || [], teamBuilderPlayers, teamBuilderPositionCap, userPrompt || '');
      if (capWarnings.length > 0) {
        parsedResult.warnings = [...(parsedResult.warnings || []), ...capWarnings];
      }

      // Say plainly which part of the instruction couldn't be applied and what the
      // roster actually calls its positions, instead of silently returning teams
      // that don't match what was asked for.
      if (teamBuilderUnmatchedQuotas.length > 0) {
        parsedResult.warnings = [
          ...(parsedResult.warnings || []),
          `"${teamBuilderUnmatchedQuotas.join('", "')}" didn't match any position on this roster, so that part of your instructions wasn't applied. This roster's positions are: ${teamBuilderRosterPositions.join(', ') || 'none set'}.`,
        ];
      }

      // Report any requested per-team count the roster couldn't supply, measured on
      // the teams that actually came back.
      if (teamBuilderQuotas.size > 0) {
        const posById = new Map(teamBuilderPlayers.map((p: any) => [p.id, normalizePos(p.pos)]));
        for (const [pos, want] of teamBuilderQuotas) {
          const short = (parsedResult.teams || []).filter(
            (t: any) => (t.players || []).filter((id: string) => posById.get(id) === pos).length !== want,
          );
          if (short.length > 0) {
            const have = teamBuilderPlayers.filter((p: any) => normalizePos(p.pos) === pos).length;
            parsedResult.warnings = [
              ...(parsedResult.warnings || []),
              `You asked for ${want} ${pos} per team but ${short.length} team(s) couldn't be filled that way — the roster has ${have} ${pos} player(s) in total for ${(parsedResult.teams || []).length} teams.`,
            ];
          }
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
