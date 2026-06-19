import type { Sport } from './types';

export interface RubricCategory {
  key: string;
  label: string;
  scale: '1-5' | '1-10';
  role: 'skater' | 'goalie';
}

const HOCKEY_SKATER: RubricCategory[] = [
  { key: 'skating', label: 'Skating', scale: '1-5', role: 'skater' },
  { key: 'puck', label: 'Puck Skills', scale: '1-5', role: 'skater' },
  { key: 'compete', label: 'Compete', scale: '1-5', role: 'skater' },
  { key: 'hockeyIQ', label: 'Hockey IQ', scale: '1-5', role: 'skater' },
  { key: 'physical', label: 'Physical', scale: '1-5', role: 'skater' },
];

const HOCKEY_GOALIE: RubricCategory[] = [
  { key: 'positioning', label: 'Positioning', scale: '1-5', role: 'goalie' },
  { key: 'rebounds', label: 'Rebounds', scale: '1-5', role: 'goalie' },
  { key: 'puckHandling', label: 'Puck Handling', scale: '1-5', role: 'goalie' },
  { key: 'athleticism', label: 'Athleticism', scale: '1-5', role: 'goalie' },
  { key: 'compete', label: 'Compete', scale: '1-5', role: 'goalie' },
];

const GENERIC: RubricCategory[] = [
  { key: 'skill', label: 'Skill', scale: '1-5', role: 'skater' },
  { key: 'athleticism', label: 'Athleticism', scale: '1-5', role: 'skater' },
  { key: 'compete', label: 'Compete', scale: '1-5', role: 'skater' },
  { key: 'iq', label: 'Game IQ', scale: '1-5', role: 'skater' },
  { key: 'teamwork', label: 'Teamwork', scale: '1-5', role: 'skater' },
];

export function getDefaultRubrics(sport: Sport): {
  skater: RubricCategory[];
  goalie: RubricCategory[];
} {
  if (sport === 'Hockey') {
    return { skater: HOCKEY_SKATER, goalie: HOCKEY_GOALIE };
  }
  return { skater: GENERIC, goalie: [] };
}

export function buildDefaultWeights(rubrics: RubricCategory[]): Record<string, number> {
  const count = rubrics.length || 1;
  const weight = Math.round((100 / count) * 100) / 100;
  return Object.fromEntries(rubrics.map((r) => [r.key, weight]));
}

export function getPlayerRubrics(
  sport: Sport,
  pos?: string,
  customRubrics: { key: string; label: string; scale: string; role?: string }[] = [],
): RubricCategory[] {
  const defaults = getDefaultRubrics(sport);
  const isGoalie = pos?.toUpperCase() === 'GTL' || pos?.toLowerCase().includes('goal');
  const base = isGoalie && defaults.goalie.length ? defaults.goalie : defaults.skater;
  const customs = customRubrics
    .filter((r) => !r.role || r.role === 'all' || (isGoalie ? r.role === 'goalie' : r.role === 'skater'))
    .map((r) => ({
      key: r.key,
      label: r.label,
      scale: (r.scale === '1-10' ? '1-10' : '1-5') as '1-5' | '1-10',
      role: (isGoalie ? 'goalie' : 'skater') as 'skater' | 'goalie',
    }));
  return [...base, ...customs];
}

export function weightedOverall(
  scores: Record<string, number>,
  weights: Record<string, number>,
  rubricKeys: string[],
): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const key of rubricKeys) {
    const score = scores[key];
    if (score == null || Number.isNaN(score)) continue;
    const w = weights[key] ?? 0;
    weightedSum += score * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100) / 100;
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

export function playerDisplayName(p: { first: string; last: string; anonymous?: boolean }): string {
  if (p.anonymous) return 'Anonymous';
  return `${p.first} ${p.last}`.trim();
}

export function playerInitials(p: { first: string; last: string }): string {
  return `${p.first.charAt(0)}${p.last.charAt(0)}`.toUpperCase();
}
