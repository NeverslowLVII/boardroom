import type { ApiConnection, ManagerConfig } from "@/types";

/** Prompt assistant de synthèse par défaut — unique source pour chat, eval et stockage client. */
export const BOARDROOM_MANAGER_DEFAULT_PROMPT = `Tu es un assistant de synthèse. Tu reçois les analyses de plusieurs contributeurs experts et tu dois :
1. Synthétiser leurs réponses en une réponse claire et structurée.
2. Identifier les consensus et les divergences entre les contributeurs.
3. Signaler si un contributeur n'a pas pu répondre (erreur technique).
4. Présenter une synthèse finale à l'utilisateur.
Sois concis, précis et fidèle aux sources.

PONDÉRATION DES CONTRIBUTIONS :
- Chaque mémo indique une pondération (1/3, 2/3 ou 3/3).
- 3/3 (Prioritaire) : avis à traiter en premier. En cas de conflit ou de divergence, privilégie ce contributeur.
- 2/3 (Standard) : avis à intégrer normalement.
- 1/3 (Complémentaire) : avis secondaire, à intégrer sans le mettre en avant.

FORMATAGE OBLIGATOIRE :
- Utilise exclusivement du Markdown standard pour structurer tes réponses.
- Pour les tableaux, utilise UNIQUEMENT la syntaxe Markdown : | Col1 | Col2 | avec |---|---| pour les séparateurs.
- N'utilise JAMAIS de l'art ASCII (┌─┐│└─┘╔═╗║╚═╝ etc.) pour dessiner des tableaux ou des cadres.
- Utilise des listes, titres (##, ###) et **gras** pour hiérarchiser l'information.

RÈGLES STRICTES DE SYNTHÈSE :
1. RESPECT LITTÉRAL DU FORMAT : Applique les contraintes de format de l'utilisateur (longueur, présence ou absence de tableaux, mots interdits, structure imposée) de manière absolue et littérale. Ne justifie JAMAIS une entorse à une règle de format sous prétexte de clarté.
2. FIDÉLITÉ DES SOLUTIONS CONCRÈTES : Lorsqu'un contributeur formule une solution exacte et concrète (étape précise, formulation textuelle à conserver, condition explicite ou choix nommé), tu dois la restituer fidèlement dans ta synthèse, sans la résumer à l'excès ni la tronquer au point d'en perdre l'essentiel.
3. VALORISATION DES COMPROMIS : La pondération indique l'autorité relative, mais tu ne dois jamais effacer une solution de compromis pertinente d'un contributeur moins pondéré si elle permet de respecter les exigences du contributeur prioritaire.
4. INTERDICTION DE PARALYSIE : Si une information est ambiguë ou incomplète, tu dois IMPÉRATIVEMENT fournir la meilleure synthèse actionnable possible avec les données présentes, plutôt que de refuser de répondre.
5. INTERDICTION DE DIFFÉRER : Livre la synthèse complète dans ce message. Interdit de remplacer la réponse par une promesse d'action future (« je vais me pencher sur », « je reviens vers vous », « n'hésitez pas à me recontacter », etc.). Tu n'es pas un interlocuteur de service : tu restitues ici le contenu utile issu des mémos.`;

export type LlmProviderKind = "nim" | "local" | "custom";

/** Clé factice pour clients OpenAI locaux (Ollama, LM Studio sans auth). */
export const LOCAL_OPENAI_DUMMY_KEY = "ollama";

export interface BoardroomSession {
  provider: LlmProviderKind;
  connectionId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  connectionName: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
  employeeDefaults: { connectionId: string; modelId: string };
}

/** @deprecated Alias — même type que BoardroomSession */
export type EvalLlmConfig = BoardroomSession;

export function resolveManagerPrompt(
  manager: ManagerConfig,
  override?: string
): string {
  return (
    override?.trim() ||
    manager.systemPrompt?.trim() ||
    process.env.BOARDROOM_MANAGER_PROMPT?.trim() ||
    BOARDROOM_MANAGER_DEFAULT_PROMPT
  );
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function inferLlmProviderFromBaseUrl(baseUrl: string): LlmProviderKind {
  const u = baseUrl.toLowerCase();
  if (/localhost|127\.0\.0\.1|:11434\b|:1234\b/.test(u)) return "local";
  if (u.includes("nvidia.com") || u.includes("integrate.api.nvidia")) {
    return "nim";
  }
  return "custom";
}

/** @deprecated Utiliser inferLlmProviderFromBaseUrl */
export const inferEvalProviderFromBaseUrl = inferLlmProviderFromBaseUrl;

export function isLikelyLocalLlmEndpoint(baseUrl: string): boolean {
  return inferLlmProviderFromBaseUrl(baseUrl) === "local";
}

/**
 * Corrige les URLs locales courantes (LM Studio = /v1, pas /api/v1).
 */
export function normalizeConnectionBaseUrl(
  url: string,
  provider: LlmProviderKind
): string {
  let u = normalizeBaseUrl(url);
  if (provider !== "local") return u;

  u = u.replace(/^http:\/\/localhost\b/i, "http://127.0.0.1");
  u = u.replace(/\/api\/v1$/i, "/v1");
  if (/\/api\/v1\/?$/i.test(u)) {
    u = u.replace(/\/api\/v1\/?$/i, "/v1");
  }
  return u;
}

/** @deprecated Utiliser normalizeConnectionBaseUrl */
export const normalizeEvalBaseUrl = normalizeConnectionBaseUrl;

export function prepareConnection(conn: ApiConnection): ApiConnection {
  const baseUrlRaw = conn.baseUrl?.trim() ?? "";
  if (!baseUrlRaw) return conn;
  const provider = inferLlmProviderFromBaseUrl(baseUrlRaw);
  const apiKey =
    conn.apiKey?.trim() ||
    (provider === "local" ? LOCAL_OPENAI_DUMMY_KEY : "");
  return {
    ...conn,
    baseUrl: normalizeConnectionBaseUrl(baseUrlRaw, provider),
    apiKey,
  };
}

export function isBoardroomConfigReady(
  manager: ManagerConfig,
  connections: ApiConnection[]
): boolean {
  const conn = connections.find((c) => c.id === manager.connectionId);
  return Boolean(conn?.baseUrl?.trim() && manager.modelId?.trim());
}

export interface BoardroomSessionParams {
  manager: ManagerConfig;
  connections: ApiConnection[];
  managerSystemPrompt?: string;
}

/** Résout manager + connexions (même logique que le chat). */
export function resolveBoardroomSession(
  params: BoardroomSessionParams
): BoardroomSession {
  const { manager, connections } = params;
  const rawConn = connections.find((c) => c.id === manager.connectionId);
  if (!rawConn) {
    throw new Error(
      "Connexion de l'assistant de synthèse introuvable. Configurez-le dans Paramètres."
    );
  }
  const conn = prepareConnection(rawConn);
  const model = manager.modelId?.trim();
  if (!model) {
    throw new Error(
      "Modèle de l'assistant de synthèse non configuré (Paramètres → Synthèse)."
    );
  }
  if (!conn.baseUrl) {
    throw new Error(`URL manquante pour la connexion « ${conn.name} ».`);
  }

  const provider = inferLlmProviderFromBaseUrl(conn.baseUrl);
  if (provider !== "local" && !conn.apiKey?.trim()) {
    throw new Error(`Clé API manquante pour « ${conn.name} ».`);
  }

  const preparedConnections = connections.map((c) =>
    c.id === conn.id ? conn : prepareConnection(c)
  );

  const resolvedManager: ManagerConfig = {
    connectionId: manager.connectionId,
    modelId: model,
    systemPrompt: resolveManagerPrompt(manager, params.managerSystemPrompt),
  };

  return {
    provider,
    connectionId: conn.id,
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    model,
    connectionName: conn.name,
    manager: resolvedManager,
    connections: preparedConnections,
    employeeDefaults: {
      connectionId: manager.connectionId,
      modelId: model,
    },
  };
}

/** @deprecated Utiliser resolveBoardroomSession */
export const resolveBoardroomLlmConfig = resolveBoardroomSession;
