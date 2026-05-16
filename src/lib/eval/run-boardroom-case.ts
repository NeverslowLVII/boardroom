import { v4 as uuidv4 } from "uuid";
import {
  buildSynthesisPrompt,
  completeManagerSynthesis,
  resolveConnection,
  sumTokenUsage,
} from "@/lib/synthesis";
import { queryEmployee } from "@/lib/employee-query";
import { throwIfAborted } from "@/lib/eval/abort";
import { buildProposalPrompt, proposeTeam } from "@/lib/team-proposal";
import type {
  ApiConnection,
  EmployeeConfig,
  EmployeeResult,
  ManagerConfig,
  ProposedEmployee,
} from "@/types";

export type EvalCasePhase =
  | "team"
  | "expert"
  | "synthesis";

export interface EvalCasePhaseDetail {
  expertName?: string;
  expertIndex?: number;
  expertTotal?: number;
}

export interface EvalRunCaseParams {
  userMessage: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
  employeeDefaults: {
    connectionId: string;
    modelId: string;
  };
  onPhase?: (phase: EvalCasePhase, detail?: EvalCasePhaseDetail) => void;
  signal?: AbortSignal;
  /** Équipe par défaut si le modèle local ne renvoie pas de JSON (eval). */
  evalFallback?: boolean;
  /** Requêtes experts en parallèle (recommandé en local / LM Studio). */
  parallelExperts?: boolean;
}

function proposedToEmployees(
  team: ProposedEmployee[],
  defaults: EvalRunCaseParams["employeeDefaults"]
): EmployeeConfig[] {
  return team.map((p) => ({
    id: uuidv4(),
    name: p.name,
    icon: p.icon,
    connectionId: defaults.connectionId,
    modelId: defaults.modelId,
    rolePrompt: p.systemPrompt,
    isActive: true,
    weight: p.weight,
  }));
}

export interface EvalRunCaseResult {
  team: ProposedEmployee[];
  teamFallback?: boolean;
  employees: EmployeeConfig[];
  memos: EmployeeResult[];
  managerResponse: string;
  teamProposalPrompt: string;
  synthesisPrompt: string;
  managerSystemPrompt: string;
  expertPrompts: { name: string; systemPrompt: string }[];
  tokenUsage?: ReturnType<typeof sumTokenUsage>;
}

export async function runBoardroomEvalCase(
  params: EvalRunCaseParams
): Promise<EvalRunCaseResult> {
  const {
    userMessage,
    manager,
    connections,
    employeeDefaults,
    onPhase,
    signal,
    evalFallback,
    parallelExperts,
  } = params;

  const managerConn = resolveConnection(manager.connectionId, connections);
  if (!managerConn) {
    throw new Error("Connexion de l'assistant de synthèse introuvable.");
  }

  throwIfAborted(signal);
  onPhase?.("team");
  const { team, usedFallback } = await proposeTeam({
    prompt: userMessage,
    manager,
    connections,
    signal,
    evalFallback,
  });

  const employees = proposedToEmployees(team, employeeDefaults);
  const history = [{ role: "user" as const, content: userMessage }];

  const memos: EmployeeResult[] = [];
  if (parallelExperts && employees.length > 1) {
    employees.forEach((emp, i) => {
      onPhase?.("expert", {
        expertName: emp.name,
        expertIndex: i + 1,
        expertTotal: employees.length,
      });
    });
    const results = await Promise.all(
      employees.map((emp) => queryEmployee(emp, connections, history, signal))
    );
    memos.push(...results);
  } else {
    for (let i = 0; i < employees.length; i++) {
      throwIfAborted(signal);
      const emp = employees[i];
      onPhase?.("expert", {
        expertName: emp.name,
        expertIndex: i + 1,
        expertTotal: employees.length,
      });
      memos.push(await queryEmployee(emp, connections, history, signal));
    }
  }

  throwIfAborted(signal);
  onPhase?.("synthesis");
  const managerPrompt = buildSynthesisPrompt(userMessage, memos, employees);

  const { content: managerResponse, tokenUsage: managerUsage } =
    await completeManagerSynthesis({
      managerConn,
      manager,
      managerPrompt,
      conversationHistory: [],
      signal,
    });

  const employeeUsage = sumTokenUsage(memos.map((m) => m.tokenUsage));
  const totalTokenUsage = sumTokenUsage([employeeUsage, managerUsage]);

  return {
    team,
    teamFallback: usedFallback,
    employees,
    memos,
    managerResponse,
    teamProposalPrompt: buildProposalPrompt(userMessage),
    synthesisPrompt: managerPrompt,
    managerSystemPrompt: manager.systemPrompt,
    expertPrompts: employees.map((e) => ({
      name: e.name,
      systemPrompt: e.rolePrompt,
    })),
    tokenUsage: totalTokenUsage,
  };
}
