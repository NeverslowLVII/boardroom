/**
 * Config LLM via variables d'environnement — réservé aux scripts CLI (sans Paramètres UI).
 * Chat et eval UI : @/lib/boardroom-config + payload manager/connections.
 */
import {
  BOARDROOM_MANAGER_DEFAULT_PROMPT,
  LOCAL_OPENAI_DUMMY_KEY,
  normalizeConnectionBaseUrl,
  resolveBoardroomSession,
  type BoardroomSession,
  type LlmProviderKind,
} from "@/lib/boardroom-config";
import type { ApiConnection, ManagerConfig } from "@/types";

export type EvalLlmProvider = LlmProviderKind;
export type EvalLlmConfig = BoardroomSession;

export {
  BOARDROOM_MANAGER_DEFAULT_PROMPT,
  LOCAL_OPENAI_DUMMY_KEY,
  normalizeConnectionBaseUrl as normalizeEvalBaseUrl,
  resolveBoardroomSession,
  resolveBoardroomSession as resolveBoardroomLlmConfig,
  isLikelyLocalLlmEndpoint,
  inferLlmProviderFromBaseUrl as inferEvalProviderFromBaseUrl,
} from "@/lib/boardroom-config";

export const EVAL_CONN_ID = "eval-llm";

export const LOCAL_DEFAULT_BASE_URL = "http://localhost:11434/v1";
export const LOCAL_DEFAULT_MODEL = "llama3.2";
export const NIM_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NIM_DEFAULT_MODEL = "moonshotai/kimi-k2.6";
export const CUSTOM_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const CUSTOM_DEFAULT_MODEL = "gpt-4o-mini";

export const EVAL_API_PRESETS = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "Groq", url: "https://api.groq.com/openai/v1" },
  { label: "Together", url: "https://api.together.xyz/v1" },
  { label: "Mistral", url: "https://api.mistral.ai/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
] as const;

export interface EvalLlmOverrides {
  provider?: EvalLlmProvider;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  managerSystemPrompt?: string;
}

export function resolveEvalProvider(
  override?: EvalLlmProvider
): EvalLlmProvider {
  if (override === "local" || override === "nim" || override === "custom") {
    return override;
  }
  const env = process.env.BOARDROOM_EVAL_PROVIDER?.trim().toLowerCase();
  if (env === "local" || env === "ollama" || env === "lmstudio") return "local";
  if (
    env === "custom" ||
    env === "openai" ||
    env === "openai_compatible" ||
    env === "api"
  ) {
    return "custom";
  }
  return "nim";
}

function buildEvalConnection(
  provider: EvalLlmProvider,
  baseUrl: string,
  apiKey: string,
  model: string,
  managerSystemPrompt: string,
  connectionName: string
): BoardroomSession {
  const manager: ManagerConfig = {
    connectionId: EVAL_CONN_ID,
    modelId: model,
    systemPrompt: managerSystemPrompt,
  };

  const connections: ApiConnection[] = [
    { id: EVAL_CONN_ID, name: connectionName, baseUrl, apiKey },
  ];

  return {
    provider,
    connectionId: EVAL_CONN_ID,
    baseUrl,
    apiKey,
    model,
    connectionName,
    manager,
    connections,
    employeeDefaults: { connectionId: EVAL_CONN_ID, modelId: model },
  };
}

export function resolveEvalLlmConfig(
  overrides: EvalLlmOverrides = {}
): BoardroomSession {
  const provider = resolveEvalProvider(overrides.provider);
  const managerSystemPrompt =
    overrides.managerSystemPrompt?.trim() ||
    process.env.BOARDROOM_MANAGER_PROMPT?.trim() ||
    BOARDROOM_MANAGER_DEFAULT_PROMPT;

  if (provider === "local") {
    const baseUrl = normalizeConnectionBaseUrl(
      overrides.baseUrl?.trim() ||
        process.env.BOARDROOM_EVAL_BASE_URL?.trim() ||
        process.env.OLLAMA_BASE_URL?.trim() ||
        LOCAL_DEFAULT_BASE_URL,
      "local"
    );
    const apiKey =
      overrides.apiKey?.trim() ||
      process.env.BOARDROOM_EVAL_API_KEY?.trim() ||
      LOCAL_OPENAI_DUMMY_KEY;
    const model =
      overrides.modelId?.trim() ||
      process.env.BOARDROOM_EVAL_MODEL?.trim() ||
      process.env.OLLAMA_MODEL?.trim() ||
      LOCAL_DEFAULT_MODEL;

    return buildEvalConnection(
      provider,
      baseUrl,
      apiKey,
      model,
      managerSystemPrompt,
      "Local (OpenAI-compatible)"
    );
  }

  if (provider === "custom") {
    const baseUrl = normalizeConnectionBaseUrl(
      overrides.baseUrl?.trim() ||
        process.env.BOARDROOM_EVAL_BASE_URL?.trim() ||
        CUSTOM_DEFAULT_BASE_URL,
      "custom"
    );
    const apiKey =
      overrides.apiKey?.trim() ||
      process.env.BOARDROOM_EVAL_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      "";
    if (!apiKey) {
      throw new Error(
        "Clé API requise pour une API personnalisée (BOARDROOM_EVAL_API_KEY ou OPENAI_API_KEY dans .env)."
      );
    }
    const model =
      overrides.modelId?.trim() ||
      process.env.BOARDROOM_EVAL_MODEL?.trim() ||
      CUSTOM_DEFAULT_MODEL;

    return buildEvalConnection(
      provider,
      baseUrl,
      apiKey,
      model,
      managerSystemPrompt,
      "API personnalisée"
    );
  }

  const apiKey = process.env.NVIDIA_NIM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "NVIDIA_NIM_API_KEY manquant dans .env (scripts CLI sans Paramètres UI)."
    );
  }

  const baseUrl = normalizeConnectionBaseUrl(
    overrides.baseUrl?.trim() ||
      process.env.NVIDIA_NIM_BASE_URL?.trim() ||
      NIM_DEFAULT_BASE_URL,
    "nim"
  );
  const model =
    overrides.modelId?.trim() ||
    process.env.NVIDIA_NIM_MODEL?.trim() ||
    NIM_DEFAULT_MODEL;

  return buildEvalConnection(
    provider,
    baseUrl,
    apiKey,
    model,
    managerSystemPrompt,
    "Nvidia NIM"
  );
}

export function resolveExecuteLlmConfig(body: {
  manager?: ManagerConfig;
  connections?: ApiConnection[];
  managerSystemPrompt?: string;
  provider?: EvalLlmProvider;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
}): BoardroomSession {
  if (
    body.manager?.connectionId &&
    Array.isArray(body.connections) &&
    body.connections.length > 0
  ) {
    return resolveBoardroomSession({
      manager: body.manager,
      connections: body.connections,
      managerSystemPrompt: body.managerSystemPrompt,
    });
  }
  return resolveEvalLlmConfig({
    provider: body.provider,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    modelId: body.modelId,
    managerSystemPrompt: body.managerSystemPrompt,
  });
}

export interface FetchEvalModelsParams {
  provider?: EvalLlmProvider;
  baseUrl?: string;
  apiKey?: string;
}

export async function fetchEvalModelsList(
  params: FetchEvalModelsParams = {}
): Promise<{
  defaultModel: string;
  provider: EvalLlmProvider;
  baseUrl: string;
  models: {
    id: string;
    ownedBy: string;
    connectionId: string;
    connectionName: string;
  }[];
  fetchError?: string;
}> {
  const cfg = resolveEvalLlmConfig({
    provider: params.provider,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        defaultModel: cfg.model,
        models: [
          {
            id: cfg.model,
            connectionId: EVAL_CONN_ID,
            connectionName: cfg.connectionName,
            ownedBy: "",
          },
        ],
        fetchError: `HTTP ${res.status}: ${text.slice(0, 120)}`,
      };
    }

    const json = (await res.json()) as {
      data?: { id: string; owned_by?: string }[];
    };

    const seen = new Set<string>();
    const models = (json.data ?? [])
      .filter((m) => {
        if (!m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .map((m) => ({
        id: m.id,
        ownedBy: m.owned_by ?? "",
        connectionId: EVAL_CONN_ID,
        connectionName: cfg.connectionName,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (!models.some((m) => m.id === cfg.model)) {
      models.unshift({
        id: cfg.model,
        ownedBy: "config",
        connectionId: EVAL_CONN_ID,
        connectionName: `${cfg.connectionName} (.env)`,
      });
    }

    return {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.model,
      models,
    };
  } catch (err) {
    const hint =
      cfg.provider === "local"
        ? "Vérifiez qu'Ollama (ollama serve) ou LM Studio est démarré."
        : cfg.provider === "custom"
          ? "Vérifiez l'URL de base (/v1) et la clé API."
          : undefined;
    const msg = err instanceof Error ? err.message : "Erreur réseau";
    return {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      defaultModel: cfg.model,
      models: [
        {
          id: cfg.model,
          connectionId: EVAL_CONN_ID,
          connectionName: cfg.connectionName,
          ownedBy: "fallback",
        },
      ],
      fetchError: hint ? `${msg} — ${hint}` : msg,
    };
  } finally {
    clearTimeout(timer);
  }
}
