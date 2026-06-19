import type { AssessorProgress, PlayerResult, Recommendation, Tryout } from './types';
import { getPlayerRubrics, weightedOverall } from './rubrics';

export function computePlayerResults(tryout: Tryout): PlayerResult[] {
  return tryout.roster.map((player) => {
    const playerEvals = tryout.evals.filter((e) => e.playerId === player.id);
    const rubrics = getPlayerRubrics(tryout.sport, player.pos, tryout.settings.customRubrics);
    const weights =
      player.pos?.toUpperCase() === 'GTL'
        ? tryout.settings.goalieWeights
        : tryout.settings.skaterWeights;

    const categoryScores: Record<string, number> = {};
    for (const rubric of rubrics) {
      const scores = playerEvals.map((e) => e.scores[rubric.key]).filter((s) => s != null);
      if (scores.length) {
        categoryScores[rubric.key] =
          Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
      }
    }

    const latestEval = playerEvals.sort((a, b) => b.createdAt - a.createdAt)[0];
    const overall =
      latestEval != null
        ? weightedOverall(latestEval.scores, weights, rubrics.map((r) => r.key))
        : 0;

    return {
      player,
      overall,
      evalCount: playerEvals.length,
      latestRecommendation: (latestEval?.recommendation ?? '') as Recommendation,
      categoryScores,
    };
  });
}

export function computeAssessorProgress(tryout: Tryout): AssessorProgress[] {
  const assessors = tryout.assessors.length
    ? tryout.assessors.map((a) => a.name)
    : [tryout.headAssessor ?? 'Coach'];

  return assessors.map((name) => {
    const scoredPlayerIds = new Set(
      tryout.evals.filter((e) => e.evaluator === name).map((e) => e.playerId),
    );
    return { name, scored: scoredPlayerIds.size, total: tryout.roster.length };
  });
}
