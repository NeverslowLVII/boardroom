import { NextRequest } from "next/server";
import { formatApiError } from "@/lib/utils";
import { verifyEvalSecret, sumTokenUsage } from "@/lib/synthesis";
import { runBoardroomEvalCase } from "@/lib/eval/run-boardroom-case";
import type {
  ApiConnection,
  ManagerConfig,
} from "@/types";

export interface EvalRunCasePayload {
  userMessage: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
  employeeDefaults: {
    connectionId: string;
    modelId: string;
  };
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const authError = verifyEvalSecret(request);
  if (authError) return authError;

  try {
    const body: EvalRunCasePayload = await request.json();
    const { userMessage, manager, connections, employeeDefaults } = body;

    if (!userMessage?.trim()) {
      return Response.json({ error: "userMessage est requis." }, { status: 400 });
    }
    if (!employeeDefaults?.connectionId || !employeeDefaults?.modelId) {
      return Response.json(
        { error: "employeeDefaults.connectionId et modelId sont requis." },
        { status: 400 }
      );
    }

    const pipeline = await runBoardroomEvalCase({
      userMessage,
      manager,
      connections,
      employeeDefaults,
    });

    return Response.json({
      team: pipeline.team,
      employees: pipeline.employees,
      memos: pipeline.memos,
      managerResponse: pipeline.managerResponse,
      synthesisPrompt: pipeline.synthesisPrompt,
      tokenUsage: pipeline.tokenUsage,
    });
  } catch (err) {
    const message = formatApiError(err);
    const status = message.includes("pas pu proposer") ? 422 : 500;
    return Response.json({ error: message }, { status });
  }
}
