import { v4 as uuidv4 } from "uuid";
import { BOARDROOM_MANAGER_DEFAULT_PROMPT } from "@/lib/eval/default-manager-prompt";
import type {
  ApiConnection,
  ManagerConfig,
  FetchedModel,
} from "@/types";

const KEYS = {
  CONNECTIONS: "boardroom_connections",
  MANAGER: "boardroom_manager",
  MODELS_CACHE: "boardroom_models_cache",
  ACTIVE_CONVERSATION: "boardroom_active_conversation",
} as const;

const DEFAULT_MANAGER: ManagerConfig = {
  connectionId: "",
  modelId: "",
  systemPrompt: BOARDROOM_MANAGER_DEFAULT_PROMPT,
};

function safeGetItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSetItem(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.error(`Failed to save to localStorage: ${key}`);
  }
}

// --- API Connections ---

export function getConnections(): ApiConnection[] {
  return safeGetItem<ApiConnection[]>(KEYS.CONNECTIONS, []);
}

export function saveConnections(connections: ApiConnection[]): void {
  safeSetItem(KEYS.CONNECTIONS, connections);
}

export function addConnection(
  connection: Omit<ApiConnection, "id">
): ApiConnection {
  const connections = getConnections();
  const newConn: ApiConnection = { ...connection, id: uuidv4() };
  connections.push(newConn);
  saveConnections(connections);
  return newConn;
}

export function deleteConnection(id: string): void {
  saveConnections(getConnections().filter((c) => c.id !== id));
}

// --- Models Cache ---

export function getModelsCache(): FetchedModel[] {
  return safeGetItem<FetchedModel[]>(KEYS.MODELS_CACHE, []);
}

export function saveModelsCache(models: FetchedModel[]): void {
  safeSetItem(KEYS.MODELS_CACHE, models);
}

// --- Manager ---

export function getManager(): ManagerConfig {
  return safeGetItem<ManagerConfig>(KEYS.MANAGER, DEFAULT_MANAGER);
}

export function saveManager(config: ManagerConfig): void {
  safeSetItem(KEYS.MANAGER, config);
}

// --- Active Conversation (stays in LocalStorage for sync access) ---

export function getActiveConversationId(): string | null {
  return safeGetItem<string | null>(KEYS.ACTIVE_CONVERSATION, null);
}

export function setActiveConversationId(id: string | null): void {
  safeSetItem(KEYS.ACTIVE_CONVERSATION, id);
}
