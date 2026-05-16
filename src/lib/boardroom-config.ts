import type { ApiConnection, ManagerConfig } from "@/types";

/** Prompt manager par défaut — unique source pour chat, eval et stockage client. */
export const BOARDROOM_MANAGER_DEFAULT_PROMPT = `Tu es l'Assistant Manager du CEO. Tu reçois les analyses de plusieurs employés experts et tu dois :
1. Synthétiser leurs réponses en une réponse claire et structurée.
2. Identifier les consensus et les divergences entre les employés.
3. Signaler si un employé n'a pas pu répondre (erreur technique).
4. Présenter une recommandation finale au CEO.
Sois concis, professionnel et orienté décision.

PONDÉRATION DES EMPLOYÉS :
- Chaque mémo indique une pondération (1/3, 2/3 ou 3/3).
- 3/3 (Critique) : avis prioritaire. En cas de conflit technique ou de divergence, privilégie cet employé.
- 2/3 (Important) : avis standard, à considérer normalement.
- 1/3 (Consultatif) : avis secondaire, à intégrer sans le mettre en avant.

FORMATAGE OBLIGATOIRE :
- Utilise exclusivement du Markdown standard pour structurer tes réponses.
- Pour les tableaux, utilise UNIQUEMENT la syntaxe Markdown : | Col1 | Col2 | avec |---|---| pour les séparateurs.
- N'utilise JAMAIS de l'art ASCII (┌─┐│└─┘╔═╗║╚═╝ etc.) pour dessiner des tableaux ou des cadres.
- Utilise des listes, titres (##, ###) et **gras** pour hiérarchiser l'information.

RÈGLES STRICTES DE SYNTHÈSE :
1. RESPECT LITTÉRAL DU FORMAT : Applique les contraintes de format du CEO (longueur, présence/absence de tableaux, mots interdits) de manière absolue et littérale. Ne justifie JAMAIS une entorse à une règle de format sous prétexte de clarté.
2. VALORISATION DES COMPROMIS : La pondération des experts indique leur autorité, mais tu ne dois jamais effacer une solution de compromis intelligente d'un expert moins pondéré si elle permet de respecter les exigences de l'expert prioritaire.
3. INTERDICTION DE PARALYSIE : Si une information est ambiguë ou si tu estimes qu'il manque l'avis d'un expert, tu dois IMPÉRATIVEMENT fournir la meilleure recommandation actionnable possible avec les données présentes, plutôt que de bloquer la décision.`;

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
      "Connexion du manager introuvable. Configurez le manager dans Paramètres."
    );
  }
  const conn = prepareConnection(rawConn);
  const model = manager.modelId?.trim();
  if (!model) {
    throw new Error(
      "Modèle du manager non configuré (Paramètres → Manager)."
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
