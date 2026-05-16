import type { JudgeScores } from "@/lib/eval/judge";

export interface ScoreAgg {
  n: number;
  omissionRate: number;
  hallucRate: number;
  respectRate: number;
}

export function aggregateJudgeScores(
  rows: { scores: JudgeScores | null }[]
): ScoreAgg {
  const valid = rows.filter((r) => r.scores != null) as {
    scores: JudgeScores;
  }[];
  const n = valid.length;
  if (n === 0) {
    return { n: 0, omissionRate: 0, hallucRate: 0, respectRate: 0 };
  }

  let omission = 0;
  let halluc = 0;
  let respect = 0;
  for (const { scores } of valid) {
    if (scores.omission_critique === 1) omission++;
    if (scores.hallucination_produit === 1) halluc++;
    if (scores.respect_contrainte === 1) respect++;
  }

  return {
    n,
    omissionRate: (100 * omission) / n,
    hallucRate: (100 * halluc) / n,
    respectRate: (100 * respect) / n,
  };
}
