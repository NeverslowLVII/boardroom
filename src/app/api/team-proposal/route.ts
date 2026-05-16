import { NextRequest } from "next/server";
import { formatApiError } from "@/lib/utils";
import { proposeTeam } from "@/lib/team-proposal";
import type { ApiConnection, ManagerConfig } from "@/types";

interface ProposalPayload {
  prompt: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ProposalPayload = await request.json();
    const { prompt, manager, connections } = body;

    const { team: proposed } = await proposeTeam({ prompt, manager, connections });
    return Response.json({ team: proposed });
  } catch (err) {
    const message = formatApiError(err);
    const status = message.includes("pas pu proposer") ? 422 : 500;
    return Response.json({ error: message }, { status });
  }
}
