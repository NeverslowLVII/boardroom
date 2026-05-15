import type { Conversation, ChatMessage, EmployeeConfig, EmployeeMemo, TokenUsage } from "@/types";

export const EXPORT_VERSION = "1" as const;

export interface ConversationExportPayload {
  exportVersion: typeof EXPORT_VERSION;
  exportedAt: string;
  purpose: string;
  analysisHints: string[];
    conversation: {
      id: string;
    title: string;
    createdAt: string;
    messageCount: number;
    employeeMemoCount: number;
    team: ExportedTeamMember[];
    messages: ExportedMessage[];
  };
}

interface ExportedTeamMember {
  id: string;
  name: string;
  icon: string;
  modelId: string;
  connectionId: string;
  weight: 1 | 2 | 3;
  isActive: boolean;
  rolePrompt: string;
}

interface ExportedMessage {
  id: string;
  role: ChatMessage["role"];
  content: string;
  timestamp: string;
  tokenUsage?: TokenUsage;
  employeeMemos?: ExportedMemo[];
}

interface ExportedMemo {
  employeeId: string;
  employeeName: string;
  employeeIcon: string;
  content: string | null;
  error: string | null;
  durationMs: number;
}

function toIso(ts: number): string {
  return new Date(ts).toISOString();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "conversation";
}

function mapMemos(memos: EmployeeMemo[]): ExportedMemo[] {
  return memos.map((m) => ({
    employeeId: m.employeeId,
    employeeName: m.employeeName,
    employeeIcon: m.employeeIcon,
    content: m.content,
    error: m.error,
    durationMs: m.durationMs,
  }));
}

function mapTeam(employees: EmployeeConfig[]): ExportedTeamMember[] {
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    icon: e.icon,
    modelId: e.modelId,
    connectionId: e.connectionId,
    weight: e.weight,
    isActive: e.isActive,
    rolePrompt: e.rolePrompt,
  }));
}

function mapMessages(messages: ChatMessage[]): ExportedMessage[] {
  return messages.map((m) => {
    const exported: ExportedMessage = {
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: toIso(m.timestamp),
    };
    if (m.tokenUsage) exported.tokenUsage = m.tokenUsage;
    if (m.employeeMemos && m.employeeMemos.length > 0) {
      exported.employeeMemos = mapMemos(m.employeeMemos);
    }
    return exported;
  });
}

export function buildConversationExport(conv: Conversation): ConversationExportPayload {
  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    purpose:
      "Full Boardroom conversation export for AI-assisted quality review, UX evaluation, and continuous product improvement.",
    analysisHints: [
      "Compare manager synthesis quality against individual employee memos.",
      "Identify missing expert perspectives, redundancies, or role misalignment.",
      "Flag user frustration, confusion, or unanswered aspects of the request.",
      "Review latency (durationMs), token usage, and error patterns per employee.",
      "Suggest prompt, team composition, or workflow improvements.",
    ],
    conversation: {
      id: conv.id,
      title: conv.title,
      createdAt: toIso(conv.createdAt),
      messageCount: conv.messages.length,
      employeeMemoCount: conv.messages.reduce(
        (n, m) => n + (m.employeeMemos?.length ?? 0),
        0
      ),
      team: mapTeam(conv.employees),
      messages: mapMessages(conv.messages),
    },
  };
}

export function conversationExportToJson(conv: Conversation): string {
  return JSON.stringify(buildConversationExport(conv), null, 2);
}

export function conversationExportFilename(conv: Conversation): string {
  const date = new Date().toISOString().slice(0, 10);
  return `boardroom-${slugify(conv.title)}-${date}.json`;
}

export function downloadConversationExport(conv: Conversation): void {
  const json = conversationExportToJson(conv);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = conversationExportFilename(conv);
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyConversationExport(conv: Conversation): Promise<void> {
  await navigator.clipboard.writeText(conversationExportToJson(conv));
}
