import { NextRequest } from "next/server";
import OpenAI from "openai";
import {
  buildSynthesisPrompt,
  extractUsage,
  formatApiError,
  LLM_MAX_OUTPUT_TOKENS,
  resolveConnection,
  sumTokenUsage,
} from "@/lib/synthesis";
import { queryEmployee } from "@/lib/employee-query";
import type {
  ApiConnection,
  EmployeeConfig,
  ManagerConfig,
  EmployeeResult,
  TokenUsage,
} from "@/types";

interface ChatPayload {
  messages: { role: "user" | "assistant"; content: string }[];
  employees: EmployeeConfig[];
  manager: ManagerConfig;
  connections: ApiConnection[];
  overrides?: Record<string, string>;
  fastMode?: boolean;
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

    const employeeTokenUsage = sumTokenUsage(
      employeeResults.map((r) => r.tokenUsage)
    );

    const stream = await managerClient.chat.completions.create({
      model: manager.modelId,
      max_tokens: LLM_MAX_OUTPUT_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
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

        let managerTokenUsage: TokenUsage | undefined;

        try {
          let insideThink = false;
          let buffer = "";

          for await (const chunk of stream) {
            if (chunk.usage) {
              managerTokenUsage = extractUsage(chunk.usage);
            }

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
              `data: ${JSON.stringify({ type: "error", error: formatApiError(err) })}\n\n`
            )
          );
        }

        const totalTokenUsage = sumTokenUsage([
          employeeTokenUsage,
          managerTokenUsage,
        ]);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              tokenUsage: totalTokenUsage,
            })}\n\n`
          )
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
    return Response.json({ error: formatApiError(err) }, { status: 500 });
  }
}
