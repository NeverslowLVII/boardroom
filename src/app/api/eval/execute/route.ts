import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { formatApiError } from "@/lib/utils";
import { verifyEvalSecret } from "@/lib/synthesis";
import {
  loadStressMatrix,
  buildDeterministicUserMessage,
  pickProfilesForRun,
} from "@/lib/eval/stress-matrix";
import { runBoardroomEvalCase } from "@/lib/eval/run-boardroom-case";
import { runJudge, type JudgeScores } from "@/lib/eval/judge";
import { aggregateJudgeScores } from "@/lib/eval/aggregate-scores";
import {
  isAbortError,
  sleepInterruptible,
  throwIfAborted,
} from "@/lib/eval/abort";
import { isLikelyLocalLlmEndpoint } from "@/lib/boardroom-config";
import {
  resolveExecuteLlmConfig,
  type EvalLlmProvider,
} from "@/lib/eval/llm-config";
import type { ApiConnection, ManagerConfig } from "@/types";

const EVAL_RUNS_DIR = path.join(process.cwd(), "scripts", "eval_runs");

const SAFE_REPORT = /^[a-zA-Z0-9._-]+\.report\.json$/;

interface ExecuteBody {
  count?: number;
  sleepMs?: number;
  /** Même payload que le chat (Paramètres). Prioritaire sur provider/baseUrl/.env */
  manager?: ManagerConfig;
  connections?: ApiConnection[];
  /** Fallback scripts / ancienne UI eval */
  provider?: EvalLlmProvider;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  managerSystemPrompt?: string;
  /** Rapport précédent (basename) pour comparaison chiffrée des agrégats */
  baselineReport?: string | null;
}

async function loadBaselineAgg(
  basename: string | null | undefined
): Promise<{ filename: string; agg: ReturnType<typeof aggregateJudgeScores> } | null> {
  if (!basename || !SAFE_REPORT.test(basename)) return null;
  const full = path.join(EVAL_RUNS_DIR, basename);
  const raw = await fs.readFile(full, "utf-8");
  const data = JSON.parse(raw) as {
    results?: { scores: JudgeScores | null }[];
  };
  if (!Array.isArray(data.results)) return null;
  return {
    filename: basename,
    agg: aggregateJudgeScores(data.results),
  };
}

function memosForJudge(
  memos: { employeeId: string; employeeName: string; content: string | null; error: string | null }[],
  employees: { id: string; weight?: number }[]
): { employeeName: string; content: string }[] {
  const weights = Object.fromEntries(
    employees.map((e) => [e.id, e.weight ?? 2])
  );
  return memos.map((m) => ({
    employeeName: `${m.employeeName} (${weights[m.employeeId] ?? 2}/3)`,
    content: m.error
      ? `[ERREUR] ${m.error}`
      : m.content ?? "",
  }));
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const authError = verifyEvalSecret(request);
  if (authError) return authError;

  let body: ExecuteBody = {};
  try {
    body = (await request.json()) as ExecuteBody;
  } catch {
    body = {};
  }

  const count = Math.min(50, Math.max(1, body.count ?? 10));
  const sleepMs = Math.min(120_000, Math.max(0, body.sleepMs ?? 5000));

  try {
    const llm = resolveExecuteLlmConfig({
      manager: body.manager,
      connections: body.connections,
      provider: body.provider,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      modelId: typeof body.modelId === "string" ? body.modelId : undefined,
      managerSystemPrompt:
        typeof body.managerSystemPrompt === "string"
          ? body.managerSystemPrompt
          : undefined,
    });

    let baseline: {
      filename: string;
      agg: ReturnType<typeof aggregateJudgeScores>;
    } | null = null;
    try {
      baseline = await loadBaselineAgg(body.baselineReport);
    } catch {
      baseline = null;
    }

    const matrix = await loadStressMatrix();
    const profiles = pickProfilesForRun(matrix.profiles, count);

    const abortSignal = request.signal;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          if (abortSignal.aborted) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
            );
          } catch {
            /* client disconnected */
          }
        };

        type CaseRow = {
          user_query: string;
          stress_profile_id: string;
          expert_memos: { employee: string; content: string }[];
          manager_response: string;
          proposed_team?: { name: string; icon: string }[];
        };
        type ResultRow = {
          case_index: number;
          stress_profile_id: string;
          scores: JudgeScores | null;
          error: string | null;
          justification_courte?: string;
        };
        const casesBuf: CaseRow[] = [];
        const resultsBuf: ResultRow[] = [];

        const saveReport = async (cancelled: boolean) => {
          const cases = casesBuf;
          const results = resultsBuf;
          const agg = aggregateJudgeScores(results);
          const regression =
            baseline && baseline.agg.n > 0 && agg.n > 0
              ? {
                  omissionDelta: agg.omissionRate - baseline.agg.omissionRate,
                  hallucDelta: agg.hallucRate - baseline.agg.hallucRate,
                  respectDelta: agg.respectRate - baseline.agg.respectRate,
                  note:
                    "Δ en points % vs baseline (omission/hallucination : baisse souhaitée ; respect : hausse souhaitée).",
                }
              : null;

          const stamp = new Date()
            .toISOString()
            .replace(/[-:]/g, "")
            .replace("T", "_")
            .slice(0, 15);
          const suffix = cancelled ? ".partial" : "";
          const reportName = `${stamp}${suffix}.report.json`;

          const report = {
            generated_at: new Date().toISOString(),
            mode: "pipeline",
            source: "eval_ui",
            deterministic: true,
            stress_matrix: true,
            stress_matrix_version: matrix.version,
            model: llm.model,
            llm_provider: llm.provider,
            llm_base_url: llm.baseUrl,
            cancelled,
            results,
            cases,
            aggregates: agg,
            baseline: baseline
              ? { filename: baseline.filename, aggregates: baseline.agg }
              : null,
            regression,
          };

          await fs.mkdir(EVAL_RUNS_DIR, { recursive: true });
          await fs.writeFile(
            path.join(EVAL_RUNS_DIR, reportName),
            JSON.stringify(report, null, 2),
            "utf-8"
          );
          return { report, reportName };
        };

        try {
          send({
            type: "start",
            total: profiles.length,
            deterministic: true,
            stressMatrixVersion: matrix.version,
            judgeModel: llm.model,
            llmProvider: llm.provider,
            llmBaseUrl: llm.baseUrl,
            baseline: baseline
              ? { filename: baseline.filename, agg: baseline.agg }
              : null,
          });

          for (let i = 0; i < profiles.length; i++) {
            throwIfAborted(abortSignal);
            const profile = profiles[i];
            if (sleepMs > 0 && i > 0) {
              send({
                type: "case_phase",
                index: i + 1,
                total: profiles.length,
                profileId: profile.id,
                phase: "sleep",
                sleepMs,
              });
              await sleepInterruptible(sleepMs, abortSignal);
            }

            const userMessage = buildDeterministicUserMessage(profile);

            send({
              type: "case_start",
              index: i + 1,
              total: profiles.length,
              profileId: profile.id,
              domain: profile.domain,
              queryPreview: userMessage.split("\n")[0]?.slice(0, 120) ?? "",
            });

            try {
              const pipeline = await runBoardroomEvalCase({
                userMessage,
                manager: llm.manager,
                connections: llm.connections,
                employeeDefaults: llm.employeeDefaults,
                signal: abortSignal,
                evalFallback: true,
                parallelExperts: isLikelyLocalLlmEndpoint(llm.baseUrl),
                onPhase: (phase, detail) => {
                  send({
                    type: "case_phase",
                    index: i + 1,
                    total: profiles.length,
                    profileId: profile.id,
                    phase,
                    expertName: detail?.expertName,
                    expertIndex: detail?.expertIndex,
                    expertTotal: detail?.expertTotal,
                  });
                },
              });

              send({
                type: "case_phase",
                index: i + 1,
                total: profiles.length,
                profileId: profile.id,
                phase: "judge",
              });

              const expert_memos = memosForJudge(
                pipeline.memos,
                pipeline.employees
              ).map((m) => ({
                employee: m.employeeName,
                content: m.content,
              }));

              casesBuf.push({
                user_query: userMessage,
                stress_profile_id: profile.id,
                expert_memos,
                manager_response: pipeline.managerResponse,
                proposed_team: pipeline.team.map((t) => ({
                  name: t.name,
                  icon: t.icon,
                })),
              });

              const judgeOut = await runJudge({
                baseUrl: llm.baseUrl,
                apiKey: llm.apiKey,
                model: llm.model,
                userMessage,
                expertMemos: memosForJudge(
                  pipeline.memos,
                  pipeline.employees
                ),
                managerResponse: pipeline.managerResponse,
                signal: abortSignal,
              });

              resultsBuf.push({
                case_index: i + 1,
                stress_profile_id: profile.id,
                scores: {
                  omission_critique: judgeOut.omission_critique,
                  hallucination_produit: judgeOut.hallucination_produit,
                  respect_contrainte: judgeOut.respect_contrainte,
                },
                error: null,
                justification_courte: judgeOut.justification_courte,
              });

              if (pipeline.teamFallback) {
                send({
                  type: "case_log",
                  index: i + 1,
                  profileId: profile.id,
                  level: "warn",
                  message:
                    "Équipe par défaut (le modèle n'a pas renvoyé de JSON valide). Scores juge toujours calculés.",
                });
              }

              send({
                type: "case_done",
                index: i + 1,
                profileId: profile.id,
                team: pipeline.team.map((t) => t.name),
                teamFallback: pipeline.teamFallback ?? false,
                scores: {
                  omission_critique: judgeOut.omission_critique,
                  hallucination_produit: judgeOut.hallucination_produit,
                  respect_contrainte: judgeOut.respect_contrainte,
                },
                justification: judgeOut.justification_courte?.slice(0, 200),
              });
            } catch (err) {
              if (isAbortError(err)) throw err;
              const msg = formatApiError(err);
              casesBuf.push({
                user_query: userMessage,
                stress_profile_id: profile.id,
                expert_memos: [],
                manager_response: "",
              });
              resultsBuf.push({
                case_index: i + 1,
                stress_profile_id: profile.id,
                scores: null,
                error: msg,
              });
              send({
                type: "case_error",
                index: i + 1,
                profileId: profile.id,
                error: msg,
              });
            }
          }

          const { report, reportName } = await saveReport(false);
          send({
            type: "complete",
            report: { ...report, reportFilename: reportName },
            reportFilename: reportName,
          });
        } catch (err) {
          if (isAbortError(err)) {
            if (resultsBuf.length > 0 || casesBuf.length > 0) {
              try {
                const { report, reportName } = await saveReport(true);
                send({
                  type: "cancelled",
                  message: "Évaluation arrêtée.",
                  report: { ...report, reportFilename: reportName },
                  reportFilename: reportName,
                });
              } catch {
                send({ type: "cancelled", message: "Évaluation arrêtée." });
              }
            } else {
              send({ type: "cancelled", message: "Évaluation arrêtée." });
            }
          } else {
            send({ type: "error", message: formatApiError(err) });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json({ error: formatApiError(err) }, { status: 500 });
  }
}
