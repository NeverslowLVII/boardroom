// --- API Connections (global, shared by employees & manager) ---

export interface ApiConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface FetchedModel {
  id: string;
  ownedBy: string;
  connectionId: string;
  connectionName: string;
}

// --- Team Proposal ---

export interface ProposedEmployee {
  name: string;
  icon: string;
  systemPrompt: string;
  justification: string;
  accepted: boolean;
  weight: 1 | 2 | 3;
}

// --- Employee ---

export interface EmployeeConfig {
  id: string;
  name: string;
  icon: string;
  connectionId: string;
  modelId: string;
  rolePrompt: string;
  isActive: boolean;
  weight: 1 | 2 | 3;
}

// --- Manager ---

export interface ManagerConfig {
  connectionId: string;
  modelId: string;
  systemPrompt: string;
}

// --- Conversation ---

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  employees: EmployeeConfig[];
  createdAt: number;
}

// --- Chat ---

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  employeeMemos?: EmployeeMemo[];
  tokenUsage?: TokenUsage;
}

export interface EmployeeMemo {
  employeeId: string;
  employeeName: string;
  employeeIcon: string;
  content: string | null;
  error: string | null;
  durationMs: number;
}

export interface EmployeeResult {
  employeeId: string;
  employeeName: string;
  employeeIcon: string;
  content: string | null;
  error: string | null;
  durationMs: number;
  tokenUsage?: TokenUsage;
}
