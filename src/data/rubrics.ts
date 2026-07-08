import type { Evaluation, Sport } from './types';

export type Scale = '1-5' | '1-10';

/** A single scored line item, e.g. "SK1 Accel" → "Acceleration / First 3 Steps". */
export interface SubSkill {
  key: string;
  label: string;
  scale: Scale;
}

/** A weighted group of sub-skills, e.g. "Skating" → 5 sub-skills. */
export interface RubricCategory {
  key: string;
  label: string;
  role: 'skater' | 'goalie';
  subskills: SubSkill[];
}

const S = (key: string, label: string): SubSkill => ({ key, label, scale: '1-5' });

// ─── Hockey (matches the web prototype 1:1) ──────────────────────────────────
const HOCKEY_SKATER: RubricCategory[] = [
  {
    key: 'skating',
    label: 'Skating',
    role: 'skater',
    subskills: [
      S('SK1 Accel', 'Acceleration / First 3 Steps'),
      S('SK2 Speed', 'Top-End Speed'),
      S('SK3 Edges', 'Edge Control'),
      S('SK4 Agility', 'Agility / Change of Direction'),
      S('SK5 Balance', 'Balance / Strength on Skates'),
    ],
  },
  {
    key: 'passing',
    label: 'Passing',
    role: 'skater',
    subskills: [
      S('PA1 Accuracy', 'Pass Accuracy'),
      S('PA2 Reception', 'Pass Reception'),
      S('PA3 Vision', 'Vision / Awareness'),
      S('PA4 Decisions', 'Decision Making'),
      S('PA5 Timing', 'Pass Strength & Timing'),
    ],
  },
  {
    key: 'shooting',
    label: 'Shooting',
    role: 'skater',
    subskills: [
      S('SH1 Power', 'Shot Power'),
      S('SH2 Accuracy', 'Shot Accuracy'),
      S('SH3 Release', 'Release Speed'),
      S('SH4 Selection', 'Shot Selection'),
      S('SH5 Instincts', 'Scoring Instincts'),
    ],
  },
  {
    key: 'iq',
    label: 'IQ',
    role: 'skater',
    subskills: [
      S('IQ1 HockeyIQ', 'Hockey IQ'),
      S('IQ2 Coachability', 'Coachability'),
      S('IQ3 Compete', 'Compete / Work Ethic'),
      S('IQ4 Defensive', 'Defensive Awareness'),
      S('IQ5 Consistency', 'Consistency'),
    ],
  },
];

const HOCKEY_GOALIE: RubricCategory[] = [
  {
    key: 'movement',
    label: 'Movement',
    role: 'goalie',
    subskills: [
      S('GM1 Crease', 'Crease Movement / T-Push'),
      S('GM2 Posts', 'Post Integration / RVH'),
      S('GM3 Angles', 'Angle Management'),
      S('GM4 Depth', 'Depth Control'),
      S('GM5 Recovery', 'Recovery Speed'),
    ],
  },
  {
    key: 'saves',
    label: 'Saves',
    role: 'goalie',
    subskills: [
      S('GS1 Tracking', 'Tracking / Eyes'),
      S('GS2 Hands', 'Glove & Blocker Control'),
      S('GS3 Body', 'Body Control / Stance'),
      S('GS4 Rebounds', 'Rebound Control'),
      S('GS5 Compete', 'Compete / Battle Level'),
    ],
  },
  {
    key: 'puck',
    label: 'Puck Play',
    role: 'goalie',
    subskills: [
      S('GP1 Handling', 'Puck Handling / Stops'),
      S('GP2 Passing', 'Passing / Outlet'),
      S('GP3 Comm', 'Communication'),
      S('GP4 Reads', 'Reads / Anticipation'),
      S('GP5 Consistency', 'Consistency'),
    ],
  },
  {
    key: 'iq',
    label: 'IQ',
    role: 'goalie',
    subskills: [
      S('GIQ1 Awareness', 'Situational Awareness'),
      S('GIQ2 Coachability', 'Coachability'),
      S('GIQ3 Toughness', 'Mental Toughness'),
      S('GIQ4 Focus', 'Focus / Reset Ability'),
      S('GIQ5 Consistency', 'Consistency'),
    ],
  },
];

const HOCKEY_SK_WEIGHTS = { skating: 0.35, passing: 0.25, shooting: 0.25, iq: 0.15 };
const HOCKEY_GO_WEIGHTS = { movement: 0.35, saves: 0.3, puck: 0.2, iq: 0.15 };

// ─── Generic fallback for non-hockey sports ──────────────────────────────────
const GENERIC_SKATER: RubricCategory[] = [
  {
    key: 'technical',
    label: 'Technical',
    role: 'skater',
    subskills: [
      S('TE1 Control', 'Ball / Implement Control'),
      S('TE2 FirstTouch', 'First Touch / Handling'),
      S('TE3 Technique', 'Core Technique'),
    ],
  },
  {
    key: 'athleticism',
    label: 'Athleticism',
    role: 'skater',
    subskills: [
      S('AT1 Speed', 'Speed'),
      S('AT2 Agility', 'Agility'),
      S('AT3 Strength', 'Strength / Balance'),
    ],
  },
  {
    key: 'compete',
    label: 'Compete',
    role: 'skater',
    subskills: [
      S('CO1 Effort', 'Effort / Work Rate'),
      S('CO2 Battles', 'Battle Level'),
      S('CO3 Coachability', 'Coachability'),
    ],
  },
  {
    key: 'iq',
    label: 'Game IQ',
    role: 'skater',
    subskills: [
      S('GI1 Decisions', 'Decision Making'),
      S('GI2 Positioning', 'Positioning / Awareness'),
      S('GI3 Consistency', 'Consistency'),
    ],
  },
];

export function getDefaultRubrics(sport: Sport): {
  skater: RubricCategory[];
  goalie: RubricCategory[];
} {
  if (sport === 'Hockey') return { skater: HOCKEY_SKATER, goalie: HOCKEY_GOALIE };
  return { skater: GENERIC_SKATER, goalie: [] };
}

export function getDefaultWeights(sport: Sport): {
  skater: Record<string, number>;
  goalie: Record<string, number>;
} {
  if (sport === 'Hockey') {
    return { skater: { ...HOCKEY_SK_WEIGHTS }, goalie: { ...HOCKEY_GO_WEIGHTS } };
  }
  const defaults = getDefaultRubrics(sport);
  return {
    skater: buildDefaultWeights(defaults.skater),
    goalie: buildDefaultWeights(defaults.goalie),
  };
}

export function isGoaliePosition(pos?: string): boolean {
  if (!pos) return false;
  const p = pos.toUpperCase();
  return p === 'GTL' || p.includes('GOAL');
}

function customToCategory(
  r: { key: string; label: string; scale: string; role?: string },
  role: 'skater' | 'goalie',
): RubricCategory {
  const scale: Scale = r.scale === '1-10' ? '1-10' : '1-5';
  return {
    key: r.key,
    label: r.label,
    role,
    subskills: [{ key: r.key, label: r.label, scale }],
  };
}

/** Categories (with sub-skills) that apply to a given player. */
export function getPlayerCategories(
  sport: Sport,
  pos?: string,
  customRubrics: { key: string; label: string; scale: string; role?: string }[] = [],
): RubricCategory[] {
  const defaults = getDefaultRubrics(sport);
  const goalie = isGoaliePosition(pos);
  const base = goalie && defaults.goalie.length ? defaults.goalie : defaults.skater;
  const role: 'skater' | 'goalie' = goalie ? 'goalie' : 'skater';
  const customs = customRubrics
    .filter((r) => !r.role || r.role === 'all' || r.role === role)
    .map((r) => customToCategory(r, role));
  return [...base, ...customs];
}

/** Backwards-compatible alias returning categories for a player. */
export const getPlayerRubrics = getPlayerCategories;

/** Flat list of every sub-skill that applies to a player. */
export function getPlayerSubskills(
  sport: Sport,
  pos?: string,
  customRubrics: { key: string; label: string; scale: string; role?: string }[] = [],
): SubSkill[] {
  return getPlayerCategories(sport, pos, customRubrics).flatMap((c) => c.subskills);
}

/** Equal weight split across categories (used for "reset weights"). */
export function buildDefaultWeights(categories: RubricCategory[]): Record<string, number> {
  const count = categories.length || 1;
  const weight = Math.round((1 / count) * 1000) / 1000;
  return Object.fromEntries(categories.map((c) => [c.key, weight]));
}

// ─── Scoring math (matches the web prototype) ────────────────────────────────

/** 1–10 scores normalize onto the 1–5 scale by halving; other scales pass through. */
export function normalizeScore(value: number | undefined, scale: Scale): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const max = scale === '1-10' ? 10 : 5;
  const clamped = Math.max(1, Math.min(max, value));
  return scale === '1-10' ? clamped / 2 : clamped;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Maps legacy rubric keys (e.g. 'SK1') to current keys (e.g. 'SK1 Accel') */
export function mapLegacyScores(
  scores: Record<string, number>,
  categories: RubricCategory[]
): Record<string, number> {
  if (!scores) return {};
  const mapped = { ...scores };
  for (const cat of categories) {
    for (const skill of cat.subskills) {
      const prefix = skill.key.split(' ')[0];
      if (mapped[prefix] !== undefined && mapped[skill.key] === undefined) {
        mapped[skill.key] = mapped[prefix];
      }
    }
  }
  return mapped;
}

/** Average of all scored sub-skills in a category, from a single score map. */
export function categoryAverage(
  scores: Record<string, number>,
  subskills: SubSkill[],
): number | null {
  const vals: number[] = [];
  for (const s of subskills) {
    const v = normalizeScore(scores[s.key], s.scale);
    if (v !== null) vals.push(v);
  }
  return mean(vals);
}

/** Average of all scored sub-skills in a category, pooled across every evaluation. */
export function categoryAverageAcrossEvals(
  evals: Evaluation[],
  subskills: SubSkill[],
): number | null {
  const vals: number[] = [];
  for (const e of evals) {
    for (const s of subskills) {
      const v = normalizeScore(e.scores?.[s.key], s.scale);
      if (v !== null) vals.push(v);
    }
  }
  return mean(vals);
}

function weightOf(
  catKey: string,
  weights: Record<string, number>,
  categories: RubricCategory[],
): number {
  if (weights[catKey] != null) return weights[catKey];
  // Custom categories without an explicit weight get an equal share.
  return 1 / (categories.length || 1);
}

/** Weighted overall from a single score map (used live while scoring). */
export function weightedOverall(
  scores: Record<string, number>,
  categories: RubricCategory[],
  weights: Record<string, number>,
): number {
  let sum = 0;
  let wsum = 0;
  for (const cat of categories) {
    const avg = categoryAverage(scores, cat.subskills);
    if (avg === null) continue;
    const w = weightOf(cat.key, weights, categories);
    if (!w) continue;
    sum += avg * w;
    wsum += w;
  }
  return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
}

/** Weighted overall pooled across every evaluation for a player. */
export function weightedOverallAcrossEvals(
  evals: Evaluation[],
  categories: RubricCategory[],
  weights: Record<string, number>,
): number {
  let sum = 0;
  let wsum = 0;
  for (const cat of categories) {
    const avg = categoryAverageAcrossEvals(evals, cat.subskills);
    if (avg === null) continue;
    const w = weightOf(cat.key, weights, categories);
    if (!w) continue;
    sum += avg * w;
    wsum += w;
  }
  return wsum ? Math.round((sum / wsum) * 100) / 100 : 0;
}

/** Per-category averages (1–5) pooled across evals, keyed by category key. */
export function categoryAveragesAcrossEvals(
  evals: Evaluation[],
  categories: RubricCategory[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of categories) {
    const avg = categoryAverageAcrossEvals(evals, cat.subskills);
    if (avg !== null) out[cat.key] = Math.round(avg * 100) / 100;
  }
  return out;
}

export function getScoreHeatLevel(score: number, max = 5): 'great' | 'good' | 'avg' | 'low' | 'poor' {
  const pct = score / max;
  if (pct >= 0.9) return 'great';
  if (pct >= 0.75) return 'good';
  if (pct >= 0.6) return 'avg';
  if (pct >= 0.45) return 'low';
  return 'poor';
}

export function generateId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${rand}` : rand;
}

export function generateAthleteId(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

export function generateCloudCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function playerDisplayName(p: { first?: string; last?: string; firstName?: string; lastName?: string; anonymous?: boolean }): string {
  if (p.anonymous) return 'Anonymous';
  const first = p.first ?? p.firstName ?? '';
  const last = p.last ?? p.lastName ?? '';
  const name = `${first} ${last}`.trim();
  return name || 'Unknown Player';
}

export function playerInitials(p: { first?: string; last?: string; firstName?: string; lastName?: string }): string {
  const first = p.first ?? p.firstName ?? '';
  const last = p.last ?? p.lastName ?? '';
  const f = first.charAt(0) || '';
  const l = last.charAt(0) || '';
  return `${f}${l}`.toUpperCase();
}
