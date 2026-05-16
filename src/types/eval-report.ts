/** Rapport JSON produit par scripts/evaluate_boardroom.py (champs pouvant varier selon versions). */

export interface EvalJudgeScores {
  omission_critique: number;
  hallucination_produit: number;
  respect_contrainte: number;
}

export interface EvalCaseResult {
  case_index: number;
  defect_profile?: string;
  stress_profile_id?: string;
  manager_source?: string;
  scores: EvalJudgeScores | null;
  error: string | null;
  justification_courte?: string;
}

export interface ScoreAggregates {
  n: number;
  omissionRate: number;
  hallucRate: number;
  respectRate: number;
}

export interface RegressionDiff {
  omissionDelta: number;
  hallucDelta: number;
  respectDelta: number;
  note: string;
}

export interface EvalReportCaseMemo {
  employee: string;
  content: string;
}

export interface EvalReportCase {
  user_query?: string;
  expert_memos?: EvalReportCaseMemo[];
  manager_response?: string;
  stress_profile_id?: string;
  proposed_team?: { name?: string; icon?: string }[];
  defect_profile?: string;
  manager_source?: string;
}

export interface EvalReport {
  mode?: string;
  source?: string;
  model?: string;
  stress_matrix?: boolean;
  stress_matrix_version?: number;
  deterministic?: boolean;
  boardroom_url?: string | null;
  config_source?: string | null;
  reportFilename?: string;
  results?: EvalCaseResult[];
  cases?: EvalReportCase[];
  aggregates?: ScoreAggregates;
  baseline?: {
    filename: string;
    aggregates: ScoreAggregates;
  } | null;
  regression?: RegressionDiff | null;
}
