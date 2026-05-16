import OpenAI from "openai";
import { formatApiError } from "@/lib/utils";
import {
  extractFinalAssistantContent,
  LLM_MAX_OUTPUT_TOKENS,
  resolveConnection,
  stripThinkingTags,
  extractUsage,
} from "@/lib/synthesis";
import type { ApiConnection, EmployeeConfig, EmployeeResult } from "@/types";

export async function queryEmployee(
  employee: EmployeeConfig,
  connections: ApiConnection[],
  messages: { role: string; content: string }[],
  signal?: AbortSignal
): Promise<EmployeeResult> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const start = Date.now();
  const conn = resolveConnection(employee.connectionId, connections);

  if (!conn) {
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: null,
      error: `Connexion introuvable (id: ${employee.connectionId})`,
      durationMs: Date.now() - start,
    };
  }

  if (!employee.rolePrompt) {
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: null,
      error: "Aucun system prompt défini pour cet employé.",
      durationMs: Date.now() - start,
    };
  }

  try {
    const client = new OpenAI({
      baseURL: conn.baseUrl,
      apiKey: conn.apiKey,
    });

    const response = await client.chat.completions.create(
      {
        model: employee.modelId,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system" as const, content: employee.rolePrompt },
          ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
      },
      { signal }
    );

    const raw = extractFinalAssistantContent(response.choices[0]?.message);
    const tokenUsage = extractUsage(response.usage);

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: stripThinkingTags(raw),
      error: null,
      durationMs: Date.now() - start,
      tokenUsage,
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw err;
    }
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: null,
      error: formatApiError(err),
      durationMs: Date.now() - start,
    };
  }
}
