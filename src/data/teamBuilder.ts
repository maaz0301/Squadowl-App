import type { Tryout } from './types';
import { playerDisplayName } from './rubrics';
import { computePlayerResults } from '@/data/scoring';

export interface TeamBuilderTeam {
  index: number;
  id: string;
  name: string;
  players: string[];
  skaters: string[];
  goalies: string[];
}

export interface TeamBuilderState {
  generatedAt: number;
  sortMethod: 'snake' | 'balanced';
  config: {
    teamCount: number;
    teamNames: string[];
    keepFriendPackages: boolean;
    splitGoalies: boolean;
  };
  ranks: { playerId: string; overall: number; rank: number }[];
  warnings: string[];
  explanation?: string;
  teams: TeamBuilderTeam[];
  /** Roster player IDs that didn't fit within the requested team count x team size and were left out on purpose, instead of being piled onto a team. */
  unassigned: string[];
}

export interface TeamBuilderConfig {
  teamCount: number;
  prompt?: string;
  teamNames?: string[];
  sortMethod?: 'snake' | 'balanced';
  keepFriendPackages?: boolean;
  splitGoalies?: boolean;
}

export function getPlayerNameMap(tryout: Tryout): Record<string, string> {
  return Object.fromEntries(
    tryout.roster.map((p) => [p.id, playerDisplayName(p)]),
  );
}

export function formatExportCsv(tryout: Tryout): string {
  const results = computePlayerResults(tryout);
  const headers = ['Rank', 'First', 'Last', 'Jersey', 'Pos', 'Overall', 'Recommendation'];
  const rows = results
    .sort((a, b) => b.overall - a.overall)
    .map((r, i) => [
      i + 1,
      r.player.first,
      r.player.last,
      r.player.jersey ?? '',
      r.player.pos ?? '',
      r.overall.toFixed(2),
      r.latestRecommendation,
    ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
