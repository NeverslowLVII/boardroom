"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EvalCaseResult,
  EvalReport,
} from "@/types/eval-report";
import type { FetchedModel } from "@/types";

import type { EvalLlmProvider } from "@/lib/eval/llm-config";
import {
  CUSTOM_DEFAULT_BASE_URL,
  EVAL_API_PRESETS,
  LOCAL_DEFAULT_BASE_URL,
  LOCAL_DEFAULT_MODEL,
  NIM_DEFAULT_MODEL,
  normalizeEvalBaseUrl,
} from "@/lib/eval/llm-config";

const EVAL_MODEL_STORAGE_KEY = "boardroom_eval_model";
const EVAL_PROVIDER_STORAGE_KEY = "boardroom_eval_provider";
const EVAL_BASE_URL_STORAGE_KEY = "boardroom_eval_base_url";
const EVAL_API_KEY_STORAGE_KEY = "boardroom_eval_api_key";

import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EvalRunPhase =
  | "sleep"
  | "team"
  | "expert"
  | "synthesis"
  | "judge";

interface RunProgressState {
  cur: number;
  total: number;
  profileId?: string;
  domain?: string;
  phase?: EvalRunPhase;
  expertName?: string;
  expertIndex?: number;
  expertTotal?: number;
  sleepMs?: number;
}

interface RunMetaState {
  model?: string;
  stressMatrixVersion?: number;
  total?: number;
  reportFilename?: string;
}

interface RunLogEntry {
  id: number;
  at: string;
  tone: "info" | "ok" | "warn" | "error";
  text: string;
}

interface LiveCaseRow {
  index: number;
  profileId: string;
  team?: string[];
  scores?: {
    omission_critique: number;
    hallucination_produit: number;
    respect_contrainte: number;
  };
  error?: string;
  justification?: string;
}

let runLogSeq = 0;

function phaseLabel(p: RunProgressState): string {
  switch (p.phase) {
    case "sleep":
      return `Pause entre cas (${p.sleepMs ?? "…"} ms)`;
    case "team":
      return "Composition de l'équipe (manager)";
    case "expert":
      return `Expert ${p.expertName ?? "…"} (${p.expertIndex ?? "?"}/${p.expertTotal ?? "?"})`;
    case "synthesis":
      return "Synthèse manager";
    case "judge":
      return "Notation juge LLM";
    default:
      return p.cur > 0 ? "Cas en cours" : "Préparation";
  }
}

function scoreChip(
  label: string,
  value: number,
  goodWhen: 0 | 1
): { label: string; ok: boolean } {
  const ok = value === goodWhen;
  return { label: `${label}: ${value}`, ok };
}

function aggregateScores(valid: EvalCaseResult[]) {
  const n = valid.length;
  const omission = valid.filter((r) => r.scores && r.scores.omission_critique === 1)
    .length;
  const halluc = valid.filter(
    (r) => r.scores && r.scores.hallucination_produit === 1
  ).length;
  const respectOk = valid.filter(
    (r) => r.scores && r.scores.respect_contrainte === 1
  ).length;
  const respectFail = valid.filter(
    (r) => r.scores && r.scores.respect_contrainte === 0
  ).length;

  return {
    n,
    omissionRate: n ? (100 * omission) / n : 0,
    hallucRate: n ? (100 * halluc) / n : 0,
    respectRate: n ? (100 * respectOk) / n : 0,
    omissionCount: omission,
    hallucCount: halluc,
    respectOkCount: respectOk,
    respectFailCount: respectFail,
  };
}

function MetricBar({
  label,
  value,
  inverted,
}: {
  label: string;
  value: number;
  inverted?: boolean;
}) {
  const good = inverted ? value >= 70 : value <= 30;
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-400">{label}</span>
        <span
          className={cn(
            "font-medium tabular-nums",
            good ? "text-emerald-400" : "text-amber-400"
          )}
        >
          {value.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            good ? "bg-emerald-500/70" : "bg-amber-500/70"
          )}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

export default function EvalDashboardPage() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [devReports, setDevReports] = useState<{ name: string }[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<RunProgressState | null>(
    null
  );
  const [runMeta, setRunMeta] = useState<RunMetaState | null>(null);
  const [runLog, setRunLog] = useState<RunLogEntry[]>([]);
  const [liveCases, setLiveCases] = useState<LiveCaseRow[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);

  const appendRunLog = useCallback(
    (tone: RunLogEntry["tone"], text: string) => {
      const at = new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setRunLog((prev) => [
        ...prev.slice(-79),
        { id: ++runLogSeq, at, tone, text },
      ]);
    },
    []
  );
  const [execCount, setExecCount] = useState(10);
  const [sleepMs, setSleepMs] = useState(5000);
  const [baselineFile, setBaselineFile] = useState("");
  const [managerPromptDraft, setManagerPromptDraft] = useState("");
  const [llmProvider, setLlmProvider] = useState<EvalLlmProvider>("nim");
  const [apiBaseUrl, setApiBaseUrl] = useState(LOCAL_DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState("");
  const usesOwnEndpoint =
    llmProvider === "local" || llmProvider === "custom";
  const [modelId, setModelId] = useState(NIM_DEFAULT_MODEL);
  const [evalModels, setEvalModels] = useState<FetchedModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsFetchHint, setModelsFetchHint] = useState<string | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthHint, setHealthHint] = useState<string | null>(null);

  const validResults = useMemo(() => {
    const r = report?.results ?? [];
    return r.filter((x) => x.scores != null);
  }, [report]);

  const stats = useMemo(() => aggregateScores(validResults), [validResults]);

  const loadFromFile = useCallback((file: File) => {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as EvalReport;
        if (!Array.isArray(data.results)) {
          throw new Error("JSON invalide : champ results manquant.");
        }
        setReport(data);
      } catch (e) {
        setReport(null);
        setParseError(e instanceof Error ? e.message : "JSON invalide.");
      }
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const fetchDevReports = useCallback(async () => {
    setLoadingReports(true);
    setParseError(null);
    try {
      const res = await fetch("/api/eval/dashboard");
      const data = (await res.json()) as {
        reports?: { name: string }[];
        error?: string;
      };
      if (!res.ok) {
        setParseError(data.error ?? "Liste indisponible (production ou dossier vide).");
        setDevReports([]);
        return;
      }
      setDevReports(data.reports ?? []);
    } catch {
      setParseError("Impossible de charger la liste des rapports.");
      setDevReports([]);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  const loadDevFile = useCallback(async (name: string) => {
    setParseError(null);
    try {
      const res = await fetch(
        `/api/eval/dashboard?file=${encodeURIComponent(name)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setParseError(
          typeof data.error === "string" ? data.error : "Erreur de lecture."
        );
        return;
      }
      setReport(data as EvalReport);
    } catch {
      setParseError("Erreur réseau.");
    }
  }, []);

  const normalizedApiBaseUrl = useMemo(
    () =>
      usesOwnEndpoint
        ? normalizeEvalBaseUrl(
            apiBaseUrl.trim() ||
              (llmProvider === "custom"
                ? CUSTOM_DEFAULT_BASE_URL
                : LOCAL_DEFAULT_BASE_URL),
            llmProvider
          )
        : "",
    [apiBaseUrl, llmProvider, usesOwnEndpoint]
  );

  const stopEvaluation = useCallback(() => {
    if (!runAbortRef.current) return;
    appendRunLog("warn", "Arrêt demandé — interruption en cours…");
    runAbortRef.current.abort();
  }, [appendRunLog]);

  const runEvaluation = useCallback(async () => {
    runAbortRef.current?.abort();
    const abort = new AbortController();
    runAbortRef.current = abort;

    setRunError(null);
    setParseError(null);
    setRunning(true);
    setRunProgress(null);
    setRunMeta(null);
    setRunLog([]);
    setLiveCases([]);
    appendRunLog("info", "Connexion au serveur d'évaluation…");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret =
      typeof window !== "undefined"
        ? localStorage.getItem("boardroom_eval_secret")
        : null;
    if (secret) headers["x-boardroom-eval-secret"] = secret;

    try {
      const res = await fetch("/api/eval/execute", {
        method: "POST",
        headers,
        signal: abort.signal,
        body: JSON.stringify({
          count: execCount,
          sleepMs,
          provider: llmProvider,
          baseUrl: usesOwnEndpoint ? normalizedApiBaseUrl || undefined : undefined,
          apiKey:
            usesOwnEndpoint && apiKey.trim() ? apiKey.trim() : undefined,
          modelId: modelId.trim() || undefined,
          baselineReport: baselineFile.trim() || undefined,
          managerSystemPrompt: managerPromptDraft.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRunError(data.error ?? `HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setRunError("Pas de flux de réponse.");
        setRunning(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const num = (v: unknown) => (typeof v === "number" ? v : undefined);
      const str = (v: unknown) => (typeof v === "string" ? v : undefined);
      const strArr = (v: unknown) =>
        Array.isArray(v) && v.every((x) => typeof x === "string")
          ? (v as string[])
          : undefined;

      while (true) {
        if (abort.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (ev.type === "start") {
            const total = num(ev.total) ?? 0;
            const judgeModel = str(ev.judgeModel);
            const version = num(ev.stressMatrixVersion);
            setRunMeta({
              model: judgeModel,
              stressMatrixVersion: version,
              total,
            });
            setRunProgress({ cur: 0, total, phase: undefined });
            appendRunLog(
              "info",
              `Run démarrée — ${total} cas, matrice v${version ?? "?"}, modèle ${judgeModel ?? modelId}`
            );
            const bl = ev.baseline as { filename?: string } | null;
            if (bl?.filename) {
              appendRunLog("info", `Baseline : ${bl.filename}`);
            }
          }

          if (ev.type === "case_start") {
            const index = num(ev.index) ?? 0;
            const total = num(ev.total) ?? 0;
            const profileId = str(ev.profileId) ?? "?";
            const domain = str(ev.domain);
            setRunProgress({
              cur: index,
              total,
              profileId,
              domain,
              phase: "team",
            });
            appendRunLog(
              "info",
              `Cas ${index}/${total} — ${profileId}${domain ? ` (${domain})` : ""}`
            );
          }

          if (ev.type === "case_phase") {
            const index = num(ev.index) ?? 0;
            const total = num(ev.total) ?? 0;
            const profileId = str(ev.profileId);
            const phase = str(ev.phase) as EvalRunPhase | undefined;
            setRunProgress((prev) => ({
              cur: index,
              total,
              profileId: profileId ?? prev?.profileId,
              domain: prev?.domain,
              phase,
              expertName: str(ev.expertName),
              expertIndex: num(ev.expertIndex),
              expertTotal: num(ev.expertTotal),
              sleepMs: num(ev.sleepMs),
            }));
            if (phase === "sleep") {
              appendRunLog(
                "info",
                `Pause ${num(ev.sleepMs) ?? sleepMs} ms avant le cas ${index}…`
              );
            } else if (phase === "team") {
              appendRunLog("info", `  → Composition d'équipe…`);
            } else if (phase === "expert") {
              appendRunLog(
                "info",
                `  → Expert ${str(ev.expertName)} (${num(ev.expertIndex)}/${num(ev.expertTotal)})`
              );
            } else if (phase === "synthesis") {
              appendRunLog("info", "  → Synthèse manager…");
            } else if (phase === "judge") {
              appendRunLog("info", "  → Juge LLM…");
            }
          }

          if (ev.type === "case_log") {
            const msg = str(ev.message);
            const level = str(ev.level);
            if (msg) {
              appendRunLog(level === "warn" ? "warn" : "info", `  ⚠ ${msg}`);
            }
          }

          if (ev.type === "case_done") {
            const index = num(ev.index) ?? 0;
            const profileId = str(ev.profileId) ?? "?";
            const team = strArr(ev.team);
            const scores = ev.scores as LiveCaseRow["scores"] | undefined;
            const justification = str(ev.justification);
            const teamFallback = ev.teamFallback === true;
            setLiveCases((prev) => [
              ...prev.filter((c) => c.index !== index),
              { index, profileId, team, scores, justification },
            ]);
            if (scores) {
              const o = scores.omission_critique;
              const h = scores.hallucination_produit;
              const r = scores.respect_contrainte;
              appendRunLog(
                o === 1 || h === 1 || r === 0 || teamFallback ? "warn" : "ok",
                `  ✓ ${profileId} — omission:${o} halluc:${h} respect:${r}${teamFallback ? " · équipe défaut" : ""}${team?.length ? ` · ${team.join(", ")}` : ""}`
              );
              if (justification) {
                appendRunLog("info", `    ${justification}`);
              }
            }
          }

          if (ev.type === "case_error") {
            const index = num(ev.index) ?? 0;
            const profileId = str(ev.profileId) ?? "?";
            const errMsg = str(ev.error) ?? "Erreur inconnue";
            setLiveCases((prev) => [
              ...prev.filter((c) => c.index !== index),
              { index, profileId, error: errMsg },
            ]);
            appendRunLog("error", `  ✗ ${profileId} — ${errMsg}`);
          }

          if (ev.type === "complete" && ev.report) {
            const filename = str(ev.reportFilename);
            setReport(ev.report as EvalReport);
            setRunMeta((m) => ({
              ...m,
              reportFilename: filename ?? m?.reportFilename,
            }));
            appendRunLog(
              "ok",
              `Terminé — rapport${filename ? ` ${filename}` : ""} enregistré dans scripts/eval_runs/`
            );
            void fetchDevReports();
          }

          if (ev.type === "cancelled") {
            const filename = str(ev.reportFilename);
            if (ev.report) {
              setReport(ev.report as EvalReport);
              void fetchDevReports();
            }
            setRunMeta((m) => ({
              ...m,
              reportFilename: filename ?? m?.reportFilename,
            }));
            appendRunLog(
              "warn",
              str(ev.message) ??
                `Arrêté${filename ? ` — rapport partiel ${filename}` : ""}`
            );
          }

          if (ev.type === "error") {
            const msg =
              typeof ev.message === "string"
                ? ev.message
                : "Erreur d'exécution.";
            setRunError(msg);
            appendRunLog("error", msg);
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        appendRunLog("warn", "Connexion interrompue (arrêt côté navigateur).");
      } else {
        const msg = e instanceof Error ? e.message : "Erreur réseau.";
        setRunError(msg);
        appendRunLog("error", msg);
      }
    } finally {
      runAbortRef.current = null;
      setRunning(false);
      setRunProgress((p) => (p ? { ...p, phase: undefined } : p));
    }
  }, [
    appendRunLog,
    baselineFile,
    execCount,
    fetchDevReports,
    managerPromptDraft,
    llmProvider,
    apiKey,
    normalizedApiBaseUrl,
    modelId,
    sleepMs,
    usesOwnEndpoint,
  ]);

  const testApiConnection = useCallback(async () => {
    setHealthChecking(true);
    setHealthHint(null);
    try {
      const q = new URLSearchParams({
        provider: llmProvider,
        baseUrl: normalizedApiBaseUrl,
      });
      if (apiKey.trim()) q.set("apiKey", apiKey.trim());
      const res = await fetch(`/api/eval/health?${q}`);
      const data = (await res.json()) as {
        ok?: boolean;
        hint?: string;
        error?: string;
        fetchError?: string;
        modelCount?: number;
      };
      if (data.ok) {
        setHealthHint(
          `Connexion OK (${data.modelCount ?? 0} modèle(s) détecté(s) depuis le serveur Next.js).`
        );
      } else {
        setHealthHint(data.hint ?? data.error ?? data.fetchError ?? "Échec.");
      }
    } catch {
      setHealthHint("Test impossible (serveur Next.js indisponible).");
    } finally {
      setHealthChecking(false);
    }
  }, [apiKey, llmProvider, normalizedApiBaseUrl]);

  const fetchEvalModels = useCallback(
    async (keepSelection = false) => {
      setModelsLoading(true);
      setModelsFetchHint(null);
      try {
        const q = new URLSearchParams({ provider: llmProvider });
        if (usesOwnEndpoint) {
          q.set("baseUrl", normalizedApiBaseUrl);
          if (apiKey.trim()) q.set("apiKey", apiKey.trim());
        }
        const res = await fetch(`/api/eval/models?${q}`);
        const data = (await res.json()) as {
          defaultModel?: string;
          models?: FetchedModel[];
          fetchError?: string;
          error?: string;
        };
        if (!res.ok) {
          setModelsFetchHint(data.error ?? "Liste de modèles indisponible.");
          return;
        }
        const list = data.models ?? [];
        setEvalModels(list);
        if (!keepSelection) {
          const saved =
            typeof window !== "undefined"
              ? localStorage.getItem(EVAL_MODEL_STORAGE_KEY)?.trim()
              : null;
          const fallback =
            llmProvider === "local"
              ? LOCAL_DEFAULT_MODEL
              : llmProvider === "custom"
                ? "gpt-4o-mini"
                : NIM_DEFAULT_MODEL;
          const pick =
            saved || data.defaultModel || list[0]?.id || fallback;
          setModelId(pick);
        }
        if (data.fetchError) {
          setModelsFetchHint(
            `Liste partielle : ${data.fetchError} (saisie manuelle possible).`
          );
        }
      } catch {
        setModelsFetchHint("Impossible de joindre l'API modèles.");
      } finally {
        setModelsLoading(false);
      }
    },
    [apiKey, llmProvider, normalizedApiBaseUrl, usesOwnEndpoint]
  );

  useEffect(() => {
    if (modelId.trim()) {
      localStorage.setItem(EVAL_MODEL_STORAGE_KEY, modelId.trim());
    }
  }, [modelId]);

  useEffect(() => {
    localStorage.setItem(EVAL_PROVIDER_STORAGE_KEY, llmProvider);
  }, [llmProvider]);

  useEffect(() => {
    if (usesOwnEndpoint && apiBaseUrl.trim()) {
      localStorage.setItem(EVAL_BASE_URL_STORAGE_KEY, apiBaseUrl.trim());
    }
  }, [apiBaseUrl, usesOwnEndpoint]);

  useEffect(() => {
    if (llmProvider === "custom" && apiKey.trim()) {
      localStorage.setItem(EVAL_API_KEY_STORAGE_KEY, apiKey.trim());
    }
  }, [apiKey, llmProvider]);

  useEffect(() => {
    const savedProvider = localStorage.getItem(
      EVAL_PROVIDER_STORAGE_KEY
    ) as EvalLlmProvider | null;
    if (
      savedProvider === "local" ||
      savedProvider === "nim" ||
      savedProvider === "custom"
    ) {
      setLlmProvider(savedProvider);
    }
    const savedBase = localStorage.getItem(EVAL_BASE_URL_STORAGE_KEY)?.trim();
    if (savedBase) setApiBaseUrl(savedBase);
    const savedKey = localStorage.getItem(EVAL_API_KEY_STORAGE_KEY)?.trim();
    if (savedKey) setApiKey(savedKey);
  }, []);

  useEffect(() => {
    void fetchDevReports();
  }, [fetchDevReports]);

  useEffect(() => {
    void fetchEvalModels();
  }, [fetchEvalModels]);

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">
            Qualité pré-prod
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Dashboard d&apos;évaluation
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Lancez une run sur la{" "}
            <strong className="font-medium text-zinc-300">
              matrice de stress déterministe
            </strong>{" "}
            (même scénarios à chaque fois) ou importez un rapport. Les scores
            reflètent le juge NIM&nbsp;: baisse des omissions / hallucinations et
            hausse du respect des contraintes = mieux. Pour comparer deux versions
            du prompt manager, enregistrez un rapport baseline puis relancez avec
            le prompt modifié.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-zinc-400 underline-offset-4 hover:text-zinc-100 hover:underline"
        >
          ← Retour au chat
        </Link>
      </header>

      <section className="rounded-2xl border border-emerald-900/50 bg-emerald-950/25 p-6">
        <h2 className="font-display text-lg font-semibold text-emerald-100/95">
          Run d&apos;évaluation (dev)
        </h2>
        <p className="mt-2 text-sm text-muted">
          Nvidia NIM, <strong className="font-medium text-zinc-300">local</strong> (Ollama,
          LM Studio) ou <strong className="font-medium text-zinc-300">autre API</strong>{" "}
          compatible OpenAI (OpenAI, Groq, Together, Mistral, OpenRouter…). Fichier{" "}
          <code className="font-mono text-xs text-zinc-400">scripts/stress_matrix.json</code>
          .
        </p>
        <label className="mt-4 block text-sm">
          <span className="text-muted">Fournisseur LLM</span>
          <select
            value={llmProvider}
            onChange={(e) => {
              const v = e.target.value as EvalLlmProvider;
              setLlmProvider(v);
              if (v === "local" && !apiBaseUrl.trim()) {
                setApiBaseUrl(LOCAL_DEFAULT_BASE_URL);
              }
              if (v === "custom" && !apiBaseUrl.trim()) {
                setApiBaseUrl(CUSTOM_DEFAULT_BASE_URL);
              }
            }}
            disabled={running}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="nim">Nvidia NIM (cloud)</option>
            <option value="local">Local (Ollama / LM Studio)</option>
            <option value="custom">Autre API (OpenAI-compatible)</option>
          </select>
        </label>
        {usesOwnEndpoint ? (
          <div className="mt-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <label className="block text-sm">
              <span className="text-muted">URL de l&apos;API (base /v1)</span>
              <input
                type="url"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                disabled={running}
                placeholder={
                  llmProvider === "custom"
                    ? CUSTOM_DEFAULT_BASE_URL
                    : LOCAL_DEFAULT_BASE_URL
                }
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs disabled:opacity-50"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {(llmProvider === "local"
                ? [
                    { label: "Ollama", url: "http://127.0.0.1:11434/v1" },
                    { label: "LM Studio", url: "http://127.0.0.1:1234/v1" },
                  ]
                : [...EVAL_API_PRESETS]
              ).map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  disabled={running}
                  onClick={() => setApiBaseUrl(preset.url)}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                disabled={running || healthChecking}
                onClick={() => void testApiConnection()}
                className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/70 disabled:opacity-50"
              >
                {healthChecking ? "Test…" : "Tester la connexion"}
              </button>
            </div>
            {normalizedApiBaseUrl !== apiBaseUrl.trim() ? (
              <p className="text-xs text-amber-400/90">
                URL utilisée :{" "}
                <code className="font-mono">{normalizedApiBaseUrl}</code>
                {llmProvider === "local" && apiBaseUrl.includes("/api/v1")
                  ? " (corrigé : LM Studio attend /v1, pas /api/v1)"
                  : null}
              </p>
            ) : null}
            {healthHint ? (
              <p
                className={cn(
                  "text-xs",
                  healthHint.startsWith("Connexion OK")
                    ? "text-emerald-400/90"
                    : "text-amber-400/90"
                )}
              >
                {healthHint}
              </p>
            ) : null}
            <label className="block text-sm">
              <span className="text-muted">
                Clé API
                {llmProvider === "local"
                  ? " (optionnel — Ollama / LM Studio)"
                  : " (requise)"}
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={running}
                placeholder={llmProvider === "local" ? "lm-studio" : "sk-…"}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs disabled:opacity-50"
              />
            </label>
            <p className="text-xs text-muted-subtle">
              .env :{" "}
              <code className="font-mono">BOARDROOM_EVAL_PROVIDER</code>,{" "}
              <code className="font-mono">BOARDROOM_EVAL_BASE_URL</code>,{" "}
              <code className="font-mono">BOARDROOM_EVAL_API_KEY</code>,{" "}
              <code className="font-mono">BOARDROOM_EVAL_MODEL</code>
            </p>
          </div>
        ) : null}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">Nombre de cas</span>
            <input
              type="number"
              min={1}
              max={50}
              value={execCount}
              onChange={(e) => setExecCount(Number(e.target.value) || 10)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Pause entre cas (ms)</span>
            <input
              type="number"
              min={0}
              max={120000}
              step={1000}
              value={sleepMs}
              onChange={(e) => setSleepMs(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>
        <label className="mt-4 block text-sm">
          <span className="text-muted">
            Modèle (manager, experts, juge)
          </span>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <select
              value={
                evalModels.some((m) => m.id === modelId) ? modelId : "__custom__"
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v !== "__custom__") setModelId(v);
              }}
              disabled={modelsLoading || running}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs disabled:opacity-50"
            >
              {modelsLoading ? (
                <option value={modelId}>Chargement…</option>
              ) : (
                <>
                  {evalModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                  {!evalModels.some((m) => m.id === modelId) && modelId ? (
                    <option value="__custom__">{modelId} (personnalisé)</option>
                  ) : null}
                  <option value="__custom__">Autre (saisie ci-contre)</option>
                </>
              )}
            </select>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={running}
              placeholder={
                llmProvider === "local"
                  ? "llama3.2"
                  : llmProvider === "custom"
                    ? "gpt-4o-mini"
                    : "moonshotai/kimi-k2.6"
              }
              list="eval-llm-models"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs disabled:opacity-50"
            />
            <datalist id="eval-llm-models">
              {evalModels.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void fetchEvalModels(true)}
              disabled={modelsLoading || running}
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-50"
              title="Actualiser la liste des modèles"
            >
              {modelsLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "↻"
              )}
            </button>
          </div>
          {modelsFetchHint ? (
            <p className="mt-1 text-xs text-amber-400/90">{modelsFetchHint}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-subtle">
              {llmProvider === "local"
                ? "Eval : modèle rapide recommandé (ex. qwen3.5-9b). Thinking conservé. Experts en parallèle."
                : llmProvider === "custom"
                  ? "Toute API OpenAI-compatible : saisissez URL + clé, ou utilisez les raccourcis."
                  : "Liste Nvidia NIM — défaut .env : NVIDIA_NIM_MODEL."}
            </p>
          )}
        </label>
        <label className="mt-4 block text-sm">
          <span className="text-muted">Baseline pour régression (optionnel)</span>
          <select
            value={baselineFile}
            onChange={(e) => setBaselineFile(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs"
          >
            <option value="">— Aucune —</option>
            {devReports.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-sm">
          <span className="text-muted">
            Surcharge prompt manager (vide = défaut app /{" "}
            <code className="font-mono text-xs">BOARDROOM_MANAGER_PROMPT</code>)
          </span>
          <textarea
            value={managerPromptDraft}
            onChange={(e) => setManagerPromptDraft(e.target.value)}
            rows={4}
            placeholder="Collez ici une variante de prompt pour A/B test factuel…"
            className="mt-1 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs leading-relaxed"
          />
        </label>
        <p className="mt-3 text-xs text-muted-subtle">
          Secret optionnel :{" "}
          <code className="font-mono">localStorage.boardroom_eval_secret</code> si{" "}
          <code className="font-mono">BOARDROOM_EVAL_SECRET</code> est défini.
        </p>
        {runError ? (
          <p className="mt-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {runError}
          </p>
        ) : null}
        {(running || runLog.length > 0) && (
          <div className="mt-6 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-200">
                {running ? "Exécution en cours" : "Dernière exécution"}
              </h3>
              {runMeta?.model ? (
                <span className="font-mono text-xs text-muted">
                  {runMeta.model}
                </span>
              ) : null}
            </div>
            {runProgress && runProgress.total > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-zinc-300">
                    {running ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-emerald-400" />
                    ) : null}
                    Cas {runProgress.cur}/{runProgress.total}
                    {runProgress.profileId ? (
                      <span className="font-mono text-xs text-muted">
                        {runProgress.profileId}
                        {runProgress.domain
                          ? ` · ${runProgress.domain}`
                          : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {phaseLabel(runProgress)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-emerald-500/70 transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        (100 * (liveCases.length + (running ? 0.15 : 0))) /
                          runProgress.total
                      )}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-subtle">
                  Pipeline par cas : équipe → experts
                  {llmProvider === "local" ? " (parallèle)" : " (séquentiel)"} →
                  synthèse → juge
                  {sleepMs > 0
                    ? ` · pause ${sleepMs} ms entre cas`
                    : ""}
                </p>
              </div>
            ) : running ? (
              <p className="flex items-center gap-2 text-sm text-zinc-400">
                <Loader2 className="size-4 animate-spin text-emerald-400" />
                Connexion au flux serveur…
              </p>
            ) : null}
            {liveCases.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-muted">
                      <th className="py-1.5 pr-2 font-medium">#</th>
                      <th className="py-1.5 pr-2 font-medium">Profil</th>
                      <th className="py-1.5 pr-2 font-medium">Scores</th>
                      <th className="py-1.5 font-medium">Équipe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...liveCases]
                      .sort((a, b) => a.index - b.index)
                      .map((c) => (
                        <tr
                          key={c.index}
                          className="border-b border-zinc-800/60"
                        >
                          <td className="py-1.5 pr-2 tabular-nums">{c.index}</td>
                          <td className="py-1.5 pr-2 font-mono">{c.profileId}</td>
                          <td className="py-1.5 pr-2">
                            {c.error ? (
                              <span
                                className="block max-w-xs text-red-400"
                                title={c.error}
                              >
                                {c.error.length > 72
                                  ? `${c.error.slice(0, 72)}…`
                                  : c.error}
                              </span>
                            ) : c.scores ? (
                              <span className="flex flex-wrap gap-1.5">
                                {[
                                  scoreChip("O", c.scores.omission_critique, 0),
                                  scoreChip(
                                    "H",
                                    c.scores.hallucination_produit,
                                    0
                                  ),
                                  scoreChip(
                                    "R",
                                    c.scores.respect_contrainte,
                                    1
                                  ),
                                ].map((s) => (
                                  <span
                                    key={s.label}
                                    className={cn(
                                      "rounded px-1 py-0.5 font-mono",
                                      s.ok
                                        ? "bg-emerald-950/60 text-emerald-400"
                                        : "bg-amber-950/60 text-amber-400"
                                    )}
                                  >
                                    {s.label}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="max-w-[12rem] truncate py-1.5 text-muted">
                            {c.team?.join(", ") ?? "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {runLog.length > 0 ? (
              <div
                className="max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-2 font-mono text-[11px] leading-relaxed"
                role="log"
                aria-live="polite"
              >
                {runLog.map((line) => (
                  <div
                    key={line.id}
                    className={cn(
                      "whitespace-pre-wrap break-words py-0.5",
                      line.tone === "ok" && "text-emerald-400/90",
                      line.tone === "warn" && "text-amber-400/90",
                      line.tone === "error" && "text-red-400/90",
                      line.tone === "info" && "text-zinc-500"
                    )}
                  >
                    <span className="text-zinc-600">{line.at}</span> {line.text}
                  </div>
                ))}
              </div>
            ) : null}
            {runMeta?.reportFilename && !running ? (
              <p className="text-xs text-emerald-400/90">
                Rapport :{" "}
                <code className="font-mono">{runMeta.reportFilename}</code>
              </p>
            ) : null}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={running}
            onClick={() => void runEvaluation()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            <Play className="size-4" />
            Lancer l&apos;évaluation
          </button>
          {running ? (
            <button
              type="button"
              onClick={stopEvaluation}
              className="inline-flex items-center gap-2 rounded-xl border border-red-800/80 bg-red-950/40 px-5 py-3 text-sm font-semibold text-red-200 transition-colors hover:bg-red-950/70"
            >
              <Square className="size-4 fill-current" />
              Arrêter
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-8 transition-colors hover:border-zinc-600">
            <BarChart3 className="size-10 shrink-0 text-zinc-500" aria-hidden />
            <div className="text-left">
              <span className="font-medium">Glisser-déposer ou cliquer</span>
              <p className="text-sm text-muted">
                Charger un rapport JSON (sans clés API&nbsp;: déjà rédigé côté
                script).
              </p>
            </div>
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFromFile(f);
              }}
            />
          </label>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-zinc-300">
              Rapports dans{" "}
              <code className="font-mono text-xs text-zinc-400">scripts/eval_runs/</code>
            </span>
            <button
              type="button"
              onClick={() => void fetchDevReports()}
              disabled={loadingReports}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {loadingReports ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Actualiser
            </button>
          </div>
          {parseError ? (
            <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {parseError}
            </p>
          ) : null}
          {devReports.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {devReports.slice(0, 12).map((r) => (
                <li key={r.name}>
                  <button
                    type="button"
                    onClick={() => void loadDevFile(r.name)}
                    className="w-full truncate rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-left text-sm font-mono text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Aucun rapport listé&nbsp;: pas en{" "}
              <code className="font-mono text-xs">npm run dev</code>, dossier vide,
              ou environnement production.
            </p>
          )}
        </div>
      </section>

      {report ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5">
              <p className="text-xs uppercase tracking-wide text-muted">Modèle juge</p>
              <p className="mt-1 truncate font-mono text-sm">{report.model ?? "—"}</p>
              <p className="mt-4 text-xs text-muted">
                Mode&nbsp;:{" "}
                <span className="text-zinc-300">{report.mode ?? "—"}</span>
              </p>
              {report.stress_matrix_version != null ? (
                <p className="mt-1 text-xs text-muted">
                  Version matrice&nbsp;:{" "}
                  <span className="font-mono text-zinc-300">
                    {report.stress_matrix_version}
                  </span>
                </p>
              ) : null}
              {report.stress_matrix != null ? (
                <p className="mt-1 text-xs text-muted">
                  Matrice stress&nbsp;:{" "}
                  <span className="text-zinc-300">
                    {report.stress_matrix ? "oui" : "non"}
                  </span>
                </p>
              ) : null}
              {report.deterministic != null ? (
                <p className="mt-1 text-xs text-muted">
                  Scénarios déterministes&nbsp;:{" "}
                  <span className="text-zinc-300">
                    {report.deterministic ? "oui" : "non"}
                  </span>
                </p>
              ) : null}
              {report.reportFilename ? (
                <p className="mt-3 text-[11px] font-mono text-muted-subtle break-all">
                  {report.reportFilename}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-5 sm:col-span-2">
              <p className="mb-4 text-xs uppercase tracking-wide text-muted">
                Agrégats ({stats.n} cas notés)
              </p>
              <div className="grid gap-6 sm:grid-cols-3">
                <MetricBar
                  label="Détection omission critique"
                  value={stats.omissionRate}
                />
                <MetricBar
                  label="Détection hallucination produit"
                  value={stats.hallucRate}
                />
                <MetricBar
                  label="Respect des contraintes"
                  value={stats.respectRate}
                  inverted
                />
              </div>
              <p className="mt-4 text-xs text-muted-subtle">
                {stats.omissionCount} cas avec omission signalée ·{" "}
                {stats.hallucCount} avec hallucination · {stats.respectOkCount}{" "}
                contraintes respectées · {stats.respectFailCount} violées
              </p>
            </div>
          </section>

          {report.regression && report.baseline ? (
            <section className="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-5">
              <h2 className="font-display text-lg font-semibold">
                Régression vs baseline
              </h2>
              <p className="mt-1 text-sm text-muted">
                Fichier de référence :{" "}
                <span className="font-mono text-xs text-zinc-300">
                  {report.baseline.filename}
                </span>
                . Δ en points de pourcentage (agrégés juge).
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-3 font-mono text-sm">
                <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-xs text-muted">Omission détectée</span>
                  <p
                    className={cn(
                      "mt-1 text-lg font-semibold tabular-nums",
                      report.regression.omissionDelta <= 0
                        ? "text-emerald-400"
                        : "text-amber-400"
                    )}
                  >
                    {report.regression.omissionDelta >= 0 ? "+" : ""}
                    {report.regression.omissionDelta.toFixed(1)} pts
                  </p>
                  <p className="text-[10px] text-muted-subtle">↓ souhaité</p>
                </li>
                <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-xs text-muted">Hallucination produit</span>
                  <p
                    className={cn(
                      "mt-1 text-lg font-semibold tabular-nums",
                      report.regression.hallucDelta <= 0
                        ? "text-emerald-400"
                        : "text-amber-400"
                    )}
                  >
                    {report.regression.hallucDelta >= 0 ? "+" : ""}
                    {report.regression.hallucDelta.toFixed(1)} pts
                  </p>
                  <p className="text-[10px] text-muted-subtle">↓ souhaité</p>
                </li>
                <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span className="text-xs text-muted">Respect contraintes</span>
                  <p
                    className={cn(
                      "mt-1 text-lg font-semibold tabular-nums",
                      report.regression.respectDelta >= 0
                        ? "text-emerald-400"
                        : "text-amber-400"
                    )}
                  >
                    {report.regression.respectDelta >= 0 ? "+" : ""}
                    {report.regression.respectDelta.toFixed(1)} pts
                  </p>
                  <p className="text-[10px] text-muted-subtle">↑ souhaité</p>
                </li>
              </ul>
              <p className="mt-4 text-xs text-muted-subtle">
                {report.regression.note}
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 font-display text-lg font-semibold">
              Détail par cas
            </h2>
            <div className="divide-y divide-zinc-800 rounded-2xl border border-zinc-800">
              {(report.results ?? []).map((row) => {
                const cas = report.cases?.[row.case_index - 1];
                const open = expanded === row.case_index;
                const stressId =
                  row.stress_profile_id ?? cas?.stress_profile_id;
                return (
                  <div key={row.case_index}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded(open ? null : row.case_index)
                      }
                      className="flex w-full items-start gap-3 px-4 py-4 text-left hover:bg-zinc-900/40"
                    >
                      {open ? (
                        <ChevronDown className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                      ) : (
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-zinc-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted">
                            Cas #{row.case_index}
                          </span>
                          {stressId ? (
                            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs">
                              {stressId}
                            </span>
                          ) : null}
                          {row.error ? (
                            <span className="rounded bg-red-950/60 px-2 py-0.5 text-xs text-red-300">
                              Erreur
                            </span>
                          ) : null}
                        </div>
                        {!open && cas?.user_query ? (
                          <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                            {cas.user_query}
                          </p>
                        ) : null}
                      </div>
                      {row.scores ? (
                        <div className="hidden shrink-0 gap-4 font-mono text-xs text-muted sm:flex">
                          <span title="omission_critique">{row.scores.omission_critique}</span>
                          <span title="hallucination_produit">
                            {row.scores.hallucination_produit}
                          </span>
                          <span title="respect_contrainte">
                            {row.scores.respect_contrainte}
                          </span>
                        </div>
                      ) : null}
                    </button>
                    {open && (cas || row.error || row.justification_courte) ? (
                      <div className="space-y-4 border-t border-zinc-800/80 px-4 py-4 pl-12">
                        {row.error ? (
                          <p className="rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300">
                            {row.error}
                          </p>
                        ) : null}
                        {cas ? (
                          <>
                            <div>
                              <p className="text-xs font-medium text-muted">
                                Requête CEO
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">
                                {cas.user_query ?? "—"}
                              </p>
                            </div>
                            {cas.expert_memos && cas.expert_memos.length > 0 ? (
                              <div>
                                <p className="text-xs font-medium text-muted">
                                  Mémos experts
                                </p>
                                <ul className="mt-2 space-y-3">
                                  {cas.expert_memos.map((m, i) => (
                                    <li
                                      key={i}
                                      className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
                                    >
                                      <p className="text-xs font-medium text-zinc-400">
                                        {m.employee}
                                      </p>
                                      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-300">
                                        {m.content}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            {cas.manager_response ? (
                              <div>
                                <p className="text-xs font-medium text-muted">
                                  Réponse manager
                                </p>
                                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed">
                                  {cas.manager_response}
                                </pre>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {row.justification_courte ? (
                          <div>
                            <p className="text-xs font-medium text-muted">
                              Juge — justification courte
                            </p>
                            <p className="mt-1 text-sm italic text-zinc-400">
                              {row.justification_courte}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        !parseError && (
          <p className="text-center text-sm text-muted">
            Chargez un rapport pour voir les graphiques et le détail des cas.
          </p>
        )
      )}
    </div>
  );
}
