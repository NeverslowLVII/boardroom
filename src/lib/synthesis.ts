import OpenAI from "openai";
import { prepareConnection } from "@/lib/boardroom-config";
import { formatApiError } from "@/lib/utils";
import type {
  ApiConnection,
  EmployeeConfig,
  EmployeeResult,
  ManagerConfig,
  TokenUsage,
} from "@/types";

/** Plafond de tokens générés (évite les réponses tronquées sur requêtes longues). */
export const LLM_MAX_OUTPUT_TOKENS = 8192;

const WEIGHT_LABELS: Record<number, string> = {
  1: "Consultatif",
  2: "Important",
  3: "Critique",
};

export function resolveConnection(
  connectionId: string,
  connections: ApiConnection[]
): ApiConnection | null {
  const conn = connections.find((c) => c.id === connectionId);
  if (!conn) return null;
  return prepareConnection(conn);
}

export function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

/** Réponse finale visible (hors bloc thinking / reasoning). */
export function extractFinalAssistantContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  return "";
}

/** Bloc reasoning (LM Studio « Thought », Qwen thinking, etc.). */
export function extractReasoningContent(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  if (!message) return "";
  const extra = message as unknown as Record<string, unknown>;
  for (const key of ["reasoning_content", "reasoning"]) {
    const v = extra[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Texte à parser (JSON, etc.) : priorité à content ; repli sur reasoning si content vide
 * (certains endpoints n'exposent la réponse structurée que dans reasoning).
 */
export function extractAssistantTextForParsing(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  const final = extractFinalAssistantContent(message);
  if (final) return final;
  return extractReasoningContent(message);
}

/** @deprecated Préférer extractFinalAssistantContent ou extractAssistantTextForParsing */
export function extractAssistantText(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | null | undefined
): string {
  return extractAssistantTextForParsing(message);
}

/** Retire les blocs markdown et autres enveloppes autour d'un JSON. */
export function stripJsonFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

export function extractUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

export function sumTokenUsage(
  usages: (TokenUsage | undefined)[]
): TokenUsage | undefined {
  const valid = usages.filter((u): u is TokenUsage => u != null);
  if (valid.length === 0) return undefined;
  return {
    promptTokens: valid.reduce((s, u) => s + u.promptTokens, 0),
    completionTokens: valid.reduce((s, u) => s + u.completionTokens, 0),
    totalTokens: valid.reduce((s, u) => s + u.totalTokens, 0),
  };
}

export function buildSynthesisPrompt(
  userMessage: string,
  results: EmployeeResult[],
  employees: EmployeeConfig[]
): string {
  const memos = results
    .map((r) => {
      const emp = employees.find((e) => e.id === r.employeeId);
      const weight = emp?.weight ?? 2;
      const weightLabel = WEIGHT_LABELS[weight] ?? "Important";

      if (r.error) {
        return `[Mémo de ${r.employeeName}] (Pondération: ${weight}/3 - ${weightLabel}) ERREUR : ${r.error} (temps: ${r.durationMs}ms)`;
      }
      return `[Mémo de ${r.employeeName}] (Pondération: ${weight}/3 - ${weightLabel}) (temps: ${r.durationMs}ms)\n${r.content}`;
    })
    .join("\n\n---\n\n");

  return `L'utilisateur a formulé la demande suivante :
"${userMessage}"

Voici les mémos des contributeurs :

${memos}

Rédige ta synthèse complète et présente-la immédiatement à l'utilisateur (pas de promesse de revenir plus tard, pas de formule de service client).

INSTRUCTION DYNAMIQUE : Analyse le niveau d'accord entre les contributeurs. S'ils sont unanimes sur la solution, privilégie une réponse courte et directe qui reprend fidèlement leurs solutions concrètes, sans section « Désaccords » ni « Compromis » superflue.`;
}

export async function completeManagerSynthesis(params: {
  managerConn: ApiConnection;
  manager: ManagerConfig;
  managerPrompt: string;
  conversationHistory?: { role: string; content: string }[];
  signal?: AbortSignal;
}): Promise<{ content: string; tokenUsage?: TokenUsage }> {
  const { managerConn, manager, managerPrompt, conversationHistory = [], signal } =
    params;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const client = new OpenAI({
    baseURL: managerConn.baseUrl,
    apiKey: managerConn.apiKey,
  });

  const response = await client.chat.completions.create(
    {
      model: manager.modelId,
      max_tokens: LLM_MAX_OUTPUT_TOKENS,
      messages: [
        { role: "system", content: manager.systemPrompt },
        ...conversationHistory.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: managerPrompt },
      ],
    },
    { signal }
  );

  const raw = extractFinalAssistantContent(response.choices[0]?.message);
  return {
    content: stripThinkingTags(raw),
    tokenUsage: extractUsage(response.usage),
  };
}

export function verifyEvalSecret(request: Request): Response | null {
  const secret = process.env.BOARDROOM_EVAL_SECRET;
  if (!secret) return null;
  const header = request.headers.get("x-boardroom-eval-secret");
  if (header !== secret) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  return null;
}

export { formatApiError };
