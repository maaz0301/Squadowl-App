import type { AddPlayerForm, Recommendation, Sport } from './types';
import type { SubSkill } from './rubrics';

/**
 * Pure helpers for generating large batches of dummy player profiles with
 * realistic, correlated scoring data. Used by the association-only "Testing
 * Tools" in registrations to stress-test rankings, filters, and reports at
 * scale. No side effects — the DataSource wires the output into the DB.
 */

/**
 * Sentinel stored in a generated player's `currentTeam` so the whole batch can
 * later be bulk-cleared without touching real roster entries.
 */
export const TEST_DATA_TAG = 'AA Test Data';

const FIRST_NAMES = [
  'Liam', 'Noah', 'Oliver', 'Ethan', 'Mason', 'Logan', 'Lucas', 'Jackson',
  'Aiden', 'Elijah', 'Carter', 'Owen', 'Wyatt', 'Leo', 'Nathan', 'Ryan',
  'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia',
  'Harper', 'Evelyn', 'Abigail', 'Ella', 'Scarlett', 'Grace', 'Chloe', 'Zoe',
  'Xavier', 'Diego', 'Mateo', 'Kai', 'Jayden', 'Cole', 'Finn', 'Hudson',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Green',
];

const LEVELS = ['AAA', 'AA', 'A', 'BB', 'House'];

/**
 * Position pools per sport. Goalie-type positions are spelled so
 * `isGoaliePosition` (matches `GTL` or anything containing `GOAL`) recognizes
 * them, ensuring goalie-role rubrics get exercised where the sport has one.
 */
export const POSITIONS_BY_SPORT: Record<Sport, string[]> = {
  Hockey: ['FWD', 'FWD', 'FWD', 'DEF', 'DEF', 'GTL'],
  Soccer: ['Forward', 'Midfield', 'Midfield', 'Defender', 'Defender', 'Goalkeeper'],
  Football: ['QB', 'RB', 'WR', 'WR', 'OL', 'DL', 'LB', 'DB'],
  Basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
  Tennis: ['Singles', 'Doubles'],
  Volleyball: ['Setter', 'Outside', 'Middle', 'Opposite', 'Libero'],
  Lacrosse: ['Attack', 'Midfield', 'Midfield', 'Defense', 'Goalie'],
  Baseball: ['Pitcher', 'Catcher', 'Infield', 'Infield', 'Outfield', 'Outfield'],
  Other: ['FWD', 'DEF', 'GTL', 'Other'],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface GeneratedPlayer {
  form: AddPlayerForm;
  /** Latent 0..1 ability so a player's scores correlate across every rubric. */
  ability: number;
}

/**
 * Build `count` dummy players for the given sport with varied ages, positions,
 * and levels. Guardian contact fields are intentionally omitted so no guardian
 * accounts/emails are created as a side effect.
 */
export function generateDummyPlayers(
  count: number,
  sport: Sport,
  currentYear: number,
): GeneratedPlayer[] {
  const positions = POSITIONS_BY_SPORT[sport] ?? POSITIONS_BY_SPORT.Other;
  const out: GeneratedPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const age = randInt(8, 18);
    out.push({
      ability: Math.random(),
      form: {
        first: pick(FIRST_NAMES),
        last: pick(LAST_NAMES),
        jersey: String(randInt(1, 99)),
        pos: pick(positions),
        yearOfBirth: String(currentYear - age),
        currentTeam: TEST_DATA_TAG,
        currentLevel: pick(LEVELS),
      },
    });
  }
  return out;
}

/**
 * Produce a realistic raw score for each applicable sub-skill, respecting its
 * scoring type, scale, and benchmark range. Values track the player's latent
 * ability (with small per-skill noise) so rankings are meaningful, and are
 * emitted in each rubric's raw units — `time` lower-is-better, `distance` /
 * `speed` higher-is-better — matching how `normalizeScore` interprets them.
 */
export function generateScoresForPlayer(
  subskills: SubSkill[],
  ability: number,
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const s of subskills) {
    const a = clamp(ability + (Math.random() - 0.5) * 0.3, 0, 1);
    const type = s.scoringType ?? 'skill';

    if (type === 'skill') {
      const max = s.scale === '1-10' ? 10 : 5;
      scores[s.key] = clamp(Math.round(1 + a * (max - 1)), 1, max);
    } else if (type === 'time') {
      // Lower is better: minVal = best (fast), maxVal = worst (slow).
      const best = s.minVal ?? 4.5;
      const worst = s.maxVal ?? 7.5;
      scores[s.key] = round2(worst - a * (worst - best));
    } else {
      // distance / speed: higher is better.
      const worst = s.minVal ?? (type === 'speed' ? 8 : 8);
      const best = s.maxVal ?? (type === 'speed' ? 24 : 40);
      scores[s.key] = round2(worst + a * (best - worst));
    }
  }
  return scores;
}

/** Map a latent ability to a plausible recommendation for the latest eval. */
export function pickRecommendation(ability: number): Recommendation {
  if (ability > 0.75) return 'Make';
  if (ability > 0.5) return 'Keep';
  if (ability > 0.3) return 'Bubble';
  return 'Release';
}
