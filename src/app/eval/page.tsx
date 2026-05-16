"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  EvalCaseResult,
  EvalReport,
} from "@/types/eval-report";
import type { FetchedModel } from "@/types";
import {
  expertsRunInParallel,
  fetchBoardroomModels,
  getManagerConnection,
  isSettingsReady,
  loadBoardroomSettings,
  loadModelsCache,
  testManagerConnection,
  type BoardroomSettings,
} from "@/lib/boardroom-settings";

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

interface CasePromptBundle {
  userQuery?: string;
  teamProposalPrompt?: string;
  synthesisPrompt?: string;
  managerSystemPrompt?: string;
  expertPrompts?: { name: string; systemPrompt: string }[];
}

interface LiveCaseRow extends CasePromptBundle {
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

function PromptBlock({
  label,
  content,
  defaultOpen = false,
}: {
  label: string;
  content?: string | null;
  defaultOpen?: boolean;
}) {
  if (!content?.trim()) return null;
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border border-zinc-800 bg-zinc-950/70"
    >
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200">
        {label}
      </summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-zinc-800 px-3 py-2 text-xs leading-relaxed text-zinc-300">
        {content}
      </pre>
    </details>
  );
}

function CasePromptsPanel({
  profileId,
  prompts,
  defaultOpenUser = false,
}: {
  profileId?: string;
  prompts: CasePromptBundle;
  defaultOpenUser?: boolean;
}) {
  const hasAny =
    prompts.userQuery ||
    prompts.teamProposalPrompt ||
    prompts.synthesisPrompt ||
    prompts.managerSystemPrompt ||
    (prompts.expertPrompts?.length ?? 0) > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-2">
      {profileId ? (
        <p className="font-mono text-xs text-muted">{profileId}</p>
      ) : null}
      <PromptBlock
        label="Requête utilisateur (message envoyé)"
        content={prompts.userQuery}
        defaultOpen={defaultOpenUser}
      />
      <PromptBlock
        label="Prompt composition d'équipe (assistant)"
        content={prompts.teamProposalPrompt}
      />
      {prompts.expertPrompts?.map((ex) => (
        <PromptBlock
          key={ex.name}
          label={`Expert — ${ex.name} (system)`}
          content={ex.systemPrompt}
        />
      ))}
      <PromptBlock
        label="System prompt assistant de synthèse (Paramètres)"
        content={prompts.managerSystemPrompt}
      />
      <PromptBlock
        label="Prompt synthèse (message utilisateur au modèle)"
        content={prompts.synthesisPrompt}
      />
    </div>
  );
}

let runLogSeq = 0;

function phaseLabel(p: RunProgressState): string {
  switch (p.phase) {
    case "sleep":
      return `Pause entre cas (${p.sleepMs ?? "…"} ms)`;
    case "team":
      return "Composition de l'équipe (assistant)";
    case "expert":
      return `Expert ${p.expertName ?? "…"} (${p.expertIndex ?? "?"}/${p.expertTotal ?? "?"})`;
    case "synthesis":
      return "Synthèse";
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
  const [currentCasePrompts, setCurrentCasePrompts] = useState<
    (CasePromptBundle & { profileId?: string }) | null
  >(null);
  const [expandedLiveCase, setExpandedLiveCase] = useState<number | null>(null);
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
  const [useDataset, setUseDataset] = useState(true);
  const [baselineFile, setBaselineFile] = useState("");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settings, setSettings] = useState<BoardroomSettings>(() => ({
    manager: { connectionId: "", modelId: "", systemPrompt: "" },
    connections: [],
  }));
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsFetchHint, setModelsFetchHint] = useState<string | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthHint, setHealthHint] = useState<string | null>(null);

  const { manager, connections } = settings;
  const activeConnection = useMemo(
    () => getManagerConnection(settings),
    [settings]
  );
  const configReady = isSettingsReady(settings);
  const expertsParallel = expertsRunInParallel(settings);

  const refreshBoardroomSettings = useCallback(() => {
    const next = loadBoardroomSettings();
    setSettings(next);
    setModels(loadModelsCache());
  }, []);

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
    setCurrentCasePrompts(null);
    setExpandedLiveCase(null);
    const { manager: managerSnapshot, connections: connectionsSnapshot } =
      loadBoardroomSettings();
    const conn = getManagerConnection({
      manager: managerSnapshot,
      connections: connectionsSnapshot,
    });
    if (!isSettingsReady({ manager: managerSnapshot, connections: connectionsSnapshot })) {
      setRunError(
        "Configurez une connexion API et le modèle de l'assistant de synthèse dans Paramètres (page chat)."
      );
      setRunning(false);
      return;
    }

    appendRunLog(
      "info",
      `Connexion — ${conn!.name}, modèle ${managerSnapshot.modelId}`
    );

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
          useDataset,
          useStressMatrix: !useDataset,
          manager: managerSnapshot,
          connections: connectionsSnapshot,
          baselineReport: baselineFile.trim() || undefined,
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
              `Run démarrée — ${total} cas, matrice v${version ?? "?"}, modèle ${judgeModel ?? managerSnapshot.modelId}`
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
            const userQuery = str(ev.userQuery);
            setRunProgress({
              cur: index,
              total,
              profileId,
              domain,
              phase: "team",
            });
            if (userQuery) {
              setCurrentCasePrompts({ profileId, userQuery });
              setLiveCases((prev) => [
                ...prev.filter((c) => c.index !== index),
                { index, profileId, userQuery },
              ]);
            }
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
              appendRunLog("info", "  → Synthèse…");
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
            const userQuery = str(ev.userQuery);
            const teamProposalPrompt = str(ev.teamProposalPrompt);
            const synthesisPrompt = str(ev.synthesisPrompt);
            const managerSystemPrompt = str(ev.managerSystemPrompt);
            const expertPrompts = Array.isArray(ev.expertPrompts)
              ? (ev.expertPrompts as { name?: string; systemPrompt?: string }[])
                  .filter(
                    (x) =>
                      typeof x?.name === "string" &&
                      typeof x?.systemPrompt === "string"
                  )
                  .map((x) => ({
                    name: x.name as string,
                    systemPrompt: x.systemPrompt as string,
                  }))
              : undefined;
            const promptBundle: CasePromptBundle = {
              userQuery,
              teamProposalPrompt,
              synthesisPrompt,
              managerSystemPrompt,
              expertPrompts,
            };
            setCurrentCasePrompts({ profileId, ...promptBundle });
            setLiveCases((prev) => [
              ...prev.filter((c) => c.index !== index),
              {
                index,
                profileId,
                team,
                scores,
                justification,
                ...promptBundle,
              },
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
    sleepMs,
    useDataset,
  ]);

  const testApiConnection = useCallback(async () => {
    setHealthChecking(true);
    setHealthHint(null);
    try {
      const result = await testManagerConnection(loadBoardroomSettings());
      setHealthHint(result.message);
    } catch {
      setHealthHint("Test impossible (serveur Next.js indisponible).");
    } finally {
      setHealthChecking(false);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    const { connections: conns, manager: mgr } = loadBoardroomSettings();
    if (conns.filter((c) => c.baseUrl?.trim() && c.apiKey).length === 0) {
      setModelsFetchHint(
        "Aucune connexion complète — configurez-les dans Paramètres."
      );
      return;
    }
    setModelsLoading(true);
    setModelsFetchHint(null);
    try {
      const { models: list, errors } = await fetchBoardroomModels(conns);
      setModels(list);
      const errForConn = errors.find((e) => e.connectionId === mgr.connectionId);
      if (errForConn) {
        setModelsFetchHint(`Connexion synthèse : ${errForConn.error}`);
      }
    } catch {
      setModelsFetchHint("Impossible de joindre l'API modèles.");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBoardroomSettings();
    setModels(loadModelsCache());
    setSettingsHydrated(true);
    void fetchDevReports();
  }, [fetchDevReports, refreshBoardroomSettings]);

  useEffect(() => {
    const onFocus = () => refreshBoardroomSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshBoardroomSettings]);

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
            reflètent le juge LLM&nbsp;: baisse des omissions / hallucinations et
            hausse du respect des contraintes = mieux. Pour comparer deux versions
            du prompt de synthèse, enregistrez un rapport baseline puis relancez avec
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
          Utilise les mêmes{" "}
          <strong className="font-medium text-zinc-300">connexions API</strong> et le{" "}
          <strong className="font-medium text-zinc-300">modèle de synthèse</strong> que le chat
          (Paramètres sur la page principale). Par défaut : requêtes WildChat{" "}
          <code className="font-mono text-xs text-zinc-400">
            scripts/data/real_queries.jsonl
          </code>
          ; option matrice de stress synthétique.
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={useDataset}
            onChange={(e) => setUseDataset(e.target.checked)}
            disabled={running}
            className="mt-0.5 rounded border-zinc-600"
          />
          <span>
            <span className="font-medium text-zinc-200">Dataset WildChat</span>
            <span className="mt-0.5 block text-muted">
              {useDataset
                ? "Tirage aléatoire dans real_queries.jsonl (comme evaluate_boardroom.py)."
                : "Scénarios utilisateur de scripts/stress_matrix.json (profils mélangés à chaque run)."}
            </span>
          </span>
        </label>
        {!settingsHydrated ? (
          <p className="mt-4 text-sm text-muted">Chargement de la configuration…</p>
        ) : !configReady ? (
          <p className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200/90">
            Configurez au moins une connexion (URL + clé) et le modèle de synthèse dans{" "}
            <Link
              href="/"
              className="font-medium underline underline-offset-2 hover:text-amber-100"
            >
              Paramètres
            </Link>{" "}
            sur la page chat, puis revenez ici.
          </p>
        ) : (
          <div className="mt-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-muted">Connexion (assistant de synthèse)</p>
                <p className="mt-0.5 font-medium text-zinc-200">
                  {activeConnection?.name ?? "—"}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-500">
                  {activeConnection?.baseUrl}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => refreshBoardroomSettings()}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                >
                  Actualiser
                </button>
                <button
                  type="button"
                  disabled={running || healthChecking}
                  onClick={() => void testApiConnection()}
                  className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/70 disabled:opacity-50"
                >
                  {healthChecking ? "Test…" : "Tester la connexion"}
                </button>
                <button
                  type="button"
                  disabled={modelsLoading || running}
                  onClick={() => void refreshModels()}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-50"
                >
                  {modelsLoading ? "Modèles…" : "Rafraîchir modèles"}
                </button>
              </div>
            </div>
            <div>
              <p className="text-muted">Modèle (synthèse, contributeurs, juge)</p>
              <p className="mt-0.5 font-mono text-xs text-zinc-300">{manager.modelId}</p>
            </div>
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
            {modelsFetchHint ? (
              <p className="text-xs text-amber-400/90">{modelsFetchHint}</p>
            ) : null}
            <p className="text-xs text-muted-subtle">
              Experts{" "}
              {expertsParallel ? "en parallèle (endpoint local)" : "séquentiels"}.
              Modifiez connexion / modèle via{" "}
              <Link href="/" className="underline underline-offset-2 hover:text-zinc-300">
                Paramètres
              </Link>
              .
            </p>
          </div>
        )}
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
        <p className="mt-4 text-xs text-muted-subtle">
          Prompt de synthèse : modifiez-le dans{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-zinc-300">
            Paramètres → Synthèse
          </Link>{" "}
          (partagé avec le chat).
        </p>
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
                  {expertsParallel ? " (parallèle)" : " (séquentiel)"} →
                  synthèse → juge
                  {sleepMs > 0
                    ? ` · pause ${sleepMs} ms entre cas`
                    : ""}
                </p>
                {currentCasePrompts ? (
                  <div className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
                    <p className="text-xs font-medium text-zinc-300">
                      Prompts du cas en cours
                    </p>
                    <CasePromptsPanel
                      profileId={currentCasePrompts.profileId}
                      prompts={currentCasePrompts}
                      defaultOpenUser
                    />
                  </div>
                ) : null}
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
                      <th className="w-8 py-1.5 pr-1 font-medium" />
                      <th className="py-1.5 pr-2 font-medium">#</th>
                      <th className="py-1.5 pr-2 font-medium">Profil</th>
                      <th className="py-1.5 pr-2 font-medium">Scores</th>
                      <th className="py-1.5 font-medium">Équipe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...liveCases]
                      .sort((a, b) => a.index - b.index)
                      .map((c) => {
                        const open = expandedLiveCase === c.index;
                        const hasPrompts =
                          c.userQuery ||
                          c.teamProposalPrompt ||
                          c.synthesisPrompt;
                        return (
                          <Fragment key={c.index}>
                            <tr className="border-b border-zinc-800/60">
                              <td className="py-1.5 pr-1">
                                {hasPrompts ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedLiveCase(open ? null : c.index)
                                    }
                                    className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                                    aria-label={
                                      open ? "Masquer les prompts" : "Voir les prompts"
                                    }
                                  >
                                    {open ? (
                                      <ChevronDown className="size-3.5" />
                                    ) : (
                                      <ChevronRight className="size-3.5" />
                                    )}
                                  </button>
                                ) : null}
                              </td>
                              <td className="py-1.5 pr-2 tabular-nums">
                                {c.index}
                              </td>
                              <td className="py-1.5 pr-2 font-mono">
                                {c.profileId}
                              </td>
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
                                      scoreChip(
                                        "O",
                                        c.scores.omission_critique,
                                        0
                                      ),
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
                              <td className="max-w-48 truncate py-1.5 text-muted">
                                {c.team?.join(", ") ?? "—"}
                              </td>
                            </tr>
                            {open && hasPrompts ? (
                              <tr className="border-b border-zinc-800/60 bg-zinc-950/40">
                                <td colSpan={5} className="px-2 py-3">
                                  <CasePromptsPanel prompts={c} />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
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
            disabled={running || !settingsHydrated || !configReady}
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
                            <CasePromptsPanel
                              profileId={stressId ?? undefined}
                              prompts={{
                                userQuery: cas.user_query,
                                teamProposalPrompt: cas.team_proposal_prompt,
                                synthesisPrompt: cas.synthesis_prompt,
                                managerSystemPrompt: cas.manager_system_prompt,
                                expertPrompts: cas.expert_prompts,
                              }}
                              defaultOpenUser
                            />
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
                                  Réponse de synthèse
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
