import { NextRequest } from "next/server";
import {
  buildSynthesisPrompt,
  completeManagerSynthesis,
  formatApiError,
  resolveConnection,
  verifyEvalSecret,
} from "@/lib/synthesis";
import type {
  ApiConnection,
  EmployeeConfig,
  EmployeeResult,
  ManagerConfig,
} from "@/types";

export interface EvalSynthesizePayload {
  userMessage: string;
  memos: EmployeeResult[];
  employees: EmployeeConfig[];
  manager: ManagerConfig;
  connections: ApiConnection[];
  /** Historique optionnel (tours précédents, sans le message CEO courant). */
  messages?: { role: "user" | "assistant"; content: string }[];
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const authError = verifyEvalSecret(request);
  if (authError) return authError;

  try {
    const body: EvalSynthesizePayload = await request.json();
    const {
      userMessage,
      memos,
      employees,
      manager,
      connections,
      messages = [],
    } = body;

    if (!userMessage?.trim()) {
      return Response.json(
        { error: "userMessage est requis." },
        { status: 400 }
      );
    }
    if (!Array.isArray(memos) || memos.length === 0) {
      return Response.json(
        { error: "memos doit contenir au moins un mémo." },
        { status: 400 }
      );
    }
    if (!Array.isArray(employees) || employees.length === 0) {
      return Response.json(
        { error: "employees est requis pour les pondérations." },
        { status: 400 }
      );
    }

    const managerConn = resolveConnection(manager.connectionId, connections);
    if (!managerConn) {
      return Response.json(
        { error: "Connexion du Manager introuvable." },
        { status: 400 }
      );
    }

    const managerPrompt = buildSynthesisPrompt(userMessage, memos, employees);

    const { content, tokenUsage } = await completeManagerSynthesis({
      managerConn,
      manager,
      managerPrompt,
      conversationHistory: messages,
    });

    return Response.json({
      managerResponse: content,
      synthesisPrompt: managerPrompt,
      tokenUsage,
    });
  } catch (err) {
    return Response.json({ error: formatApiError(err) }, { status: 500 });
  }
}
