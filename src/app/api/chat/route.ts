import { NextRequest } from "next/server";
import OpenAI from "openai";
import type {
  ApiConnection,
  EmployeeConfig,
  ManagerConfig,
  EmployeeResult,
} from "@/types";

interface ChatPayload {
  messages: { role: "user" | "assistant"; content: string }[];
  employees: EmployeeConfig[];
  manager: ManagerConfig;
  connections: ApiConnection[];
  overrides?: Record<string, string>;
  fastMode?: boolean;
}

function resolveConnection(
  connectionId: string,
  connections: ApiConnection[]
): ApiConnection | null {
  return connections.find((c) => c.id === connectionId) ?? null;
}

function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function queryEmployee(
  employee: EmployeeConfig,
  connections: ApiConnection[],
  messages: { role: string; content: string }[]
): Promise<EmployeeResult> {
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

    const response = await client.chat.completions.create({
      model: employee.modelId,
      messages: [
        { role: "system" as const, content: employee.rolePrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";

    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: stripThinkingTags(raw),
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeIcon: employee.icon,
      content: null,
      error: err instanceof Error ? err.message : "Unknown error",
      durationMs: Date.now() - start,
    };
  }
}

const WEIGHT_LABELS: Record<number, string> = {
  1: "Consultatif",
  2: "Important",
  3: "Critique",
};

function buildSynthesisPrompt(
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

  return `Le CEO a posé la question suivante :
"${userMessage}"

Voici les mémos de tes employés :

${memos}

Fais ta synthèse et présente ta réponse au CEO.`;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatPayload = await request.json();
    const { messages, employees, manager, connections, overrides, fastMode } = body;

    const managerConn = resolveConnection(manager.connectionId, connections);
    if (!managerConn) {
      return Response.json(
        { error: "Connexion du Manager introuvable. Vérifiez la configuration." },
        { status: 400 }
      );
    }

    const activeEmployees = employees.filter((e) => e.isActive);
    const userMessage = messages[messages.length - 1]?.content ?? "";
    const conversationHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let employeeResults: EmployeeResult[] = [];
    let managerPrompt: string;

    if (fastMode) {
      managerPrompt = userMessage;
    } else {
      // Phase 1: parallel employee queries (with optional per-employee overrides)
      employeeResults = await Promise.all(
        activeEmployees.map((emp) => {
          let history = conversationHistory;

          const override = overrides?.[emp.id];
          if (override?.trim()) {
            history = [...history];
            const lastIdx = history.length - 1;
            if (lastIdx >= 0 && history[lastIdx].role === "user") {
              history[lastIdx] = {
                ...history[lastIdx],
                content: `${history[lastIdx].content}\n\n[Instruction spécifique pour vous : ${override.trim()}]`,
              };
            }
          }

          return queryEmployee(emp, connections, history);
        })
      );

      managerPrompt = buildSynthesisPrompt(userMessage, employeeResults, activeEmployees);
    }

    const managerClient = new OpenAI({
      baseURL: managerConn.baseUrl,
      apiKey: managerConn.apiKey,
    });

    const stream = await managerClient.chat.completions.create({
      model: manager.modelId,
      stream: true,
      messages: [
        { role: "system", content: manager.systemPrompt },
        ...conversationHistory.slice(0, -1).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: managerPrompt },
      ],
    });

    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "memos", memos: employeeResults })}\n\n`
          )
        );

        try {
          let insideThink = false;
          let buffer = "";

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta && "reasoning_content" in delta) continue;

            const content = delta?.content;
            if (!content) continue;

            buffer += content;

            while (buffer.length > 0) {
              if (insideThink) {
                const closeIdx = buffer.indexOf("</think>");
                if (closeIdx === -1) {
                  buffer = "";
                  break;
                }
                buffer = buffer.slice(closeIdx + "</think>".length);
                insideThink = false;
              } else {
                const openIdx = buffer.indexOf("<think>");
                if (openIdx === -1) {
                  if (buffer) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "content", content: buffer })}\n\n`
                      )
                    );
                  }
                  buffer = "";
                  break;
                }
                if (openIdx > 0) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "content", content: buffer.slice(0, openIdx) })}\n\n`
                    )
                  );
                }
                buffer = buffer.slice(openIdx + "<think>".length);
                insideThink = true;
              }
            }
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: err instanceof Error ? err.message : "Streaming error" })}\n\n`
            )
          );
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
