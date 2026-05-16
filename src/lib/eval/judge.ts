import OpenAI from "openai";
import {
  extractAssistantTextForParsing,
  stripJsonFences,
  stripThinkingTags,
} from "@/lib/synthesis";

export interface JudgeScores {
  omission_critique: number;
  hallucination_produit: number;
  respect_contrainte: number;
  justification_courte?: string;
}

const JUDGE_SYSTEM = `Tu es un évaluateur d'algorithme impitoyable. Analyse la [Réponse du Manager] par rapport à la [Requête Utilisateur] et aux [Mémos des Experts].
Évalue les critères suivants avec 1 (Vrai/Succès) ou 0 (Faux/Échec) :
1. omission_critique : Le manager a-t-il ignoré une recommandation majeure présente dans les mémos ?
2. hallucination_produit : Le manager a-t-il inventé ou modifié la posologie ou l'usage d'un produit ?
3. respect_contrainte : Le manager a-t-il respecté la contrainte explicite de l'utilisateur ?

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour :
{"omission_critique":0,"hallucination_produit":0,"respect_contrainte":1,"justification_courte":"..."}`;

const JUDGE_SYSTEM_COMPACT = `Réponds UNIQUEMENT en JSON (4 clés, valeurs 0 ou 1 pour les 3 premiers) :
{"omission_critique":0,"hallucination_produit":0,"respect_contrainte":1,"justification_courte":"une phrase"}`;

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function to01(v: unknown): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v >= 1 ? 1 : 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "oui", "yes", "vrai"].includes(s)) return 1;
    if (["0", "false", "non", "no", "faux"].includes(s)) return 0;
  }
  throw new Error("Score juge invalide");
}

function scoresFromRecord(src: Record<string, unknown>): JudgeScores | null {
  try {
    return {
      omission_critique: to01(src.omission_critique),
      hallucination_produit: to01(src.hallucination_produit),
      respect_contrainte: to01(src.respect_contrainte),
      justification_courte:
        typeof src.justification_courte === "string"
          ? src.justification_courte.slice(0, 500)
          : typeof src.justification === "string"
            ? src.justification.slice(0, 500)
            : undefined,
    };
  } catch {
    return null;
  }
}

function parseJudgePayload(parsed: unknown): JudgeScores | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  if (o.scores && typeof o.scores === "object") {
    const nested = scoresFromRecord(o.scores as Record<string, unknown>);
    if (nested) return nested;
  }
  if (o.result && typeof o.result === "object") {
    const nested = scoresFromRecord(o.result as Record<string, unknown>);
    if (nested) return nested;
  }

  return scoresFromRecord(o);
}

function parseJudgeScoresFromRegex(text: string): JudgeScores | null {
  const omit = text.match(/omission_critique["'\s:]*([01])/i);
  const hall = text.match(/hallucination_produit["'\s:]*([01])/i);
  const resp = text.match(/respect_contrainte["'\s:]*([01])/i);
  if (!omit || !hall || !resp) return null;
  try {
    return {
      omission_critique: to01(omit[1]),
      hallucination_produit: to01(hall[1]),
      respect_contrainte: to01(resp[1]),
      justification_courte: undefined,
    };
  } catch {
    return null;
  }
}

export function parseJudgeResponse(raw: string): JudgeScores {
  const cleaned = stripJsonFences(stripThinkingTags(raw));
  const attempts = [cleaned];
  const balanced = extractBalancedJsonObject(cleaned);
  if (balanced) attempts.push(balanced);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const scores = parseJudgePayload(parsed);
      if (scores) return scores;
    } catch {
      /* essai suivant */
    }
  }

  const fromRegex = parseJudgeScoresFromRegex(cleaned);
  if (fromRegex) return fromRegex;

  const excerpt = cleaned.slice(0, 200).replace(/\s+/g, " ");
  throw new Error(
    excerpt
      ? `Réponse juge : JSON introuvable. Extrait : « ${excerpt}… »`
      : "Réponse juge : JSON introuvable"
  );
}

function truncateForJudge(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… contenu tronqué pour le juge …]`;
}

async function callJudge(
  client: OpenAI,
  model: string,
  system: string,
  userContent: string,
  signal: AbortSignal | undefined,
  jsonObject: boolean
): Promise<string> {
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };
  if (jsonObject) {
    body.response_format = { type: "json_object" };
  }
  const res = await client.chat.completions.create(body, { signal });
  return extractAssistantTextForParsing(res.choices[0]?.message);
}

export async function runJudge(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  userMessage: string;
  expertMemos: { employeeName: string; content: string }[];
  managerResponse: string;
  signal?: AbortSignal;
}): Promise<JudgeScores> {
  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const memosText = params.expertMemos
    .map((m) => `### ${m.employeeName}\n${m.content}`)
    .join("\n\n");

  const userContent = truncateForJudge(
    `[Requête Utilisateur]
${params.userMessage}

[Mémos des Experts]
${memosText}

[Réponse du Manager]
${params.managerResponse}`,
    12_000
  );

  const client = new OpenAI({
    baseURL: params.baseUrl,
    apiKey: params.apiKey,
  });

  const { signal } = params;
  const attempts: {
    system: string;
    user: string;
    jsonObject: boolean;
  }[] = [
    { system: JUDGE_SYSTEM, user: userContent, jsonObject: true },
    { system: JUDGE_SYSTEM, user: userContent, jsonObject: false },
    {
      system: JUDGE_SYSTEM_COMPACT,
      user: `Évalue en JSON uniquement (0 ou 1).\n\nRequête (extrait): ${params.userMessage.slice(0, 800)}\n\nRéponse manager (extrait): ${params.managerResponse.slice(0, 1500)}`,
      jsonObject: true,
    },
    {
      system: JUDGE_SYSTEM_COMPACT,
      user: `Évalue en JSON uniquement (0 ou 1).\n\nRequête (extrait): ${params.userMessage.slice(0, 800)}\n\nRéponse manager (extrait): ${params.managerResponse.slice(0, 1500)}`,
      jsonObject: false,
    },
  ];

  let lastRaw = "";
  for (const attempt of attempts) {
    try {
      lastRaw = await callJudge(
        client,
        params.model,
        attempt.system,
        attempt.user,
        signal,
        attempt.jsonObject
      );
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw err;
      }
      if (attempt.jsonObject) continue;
      throw err;
    }
    try {
      return parseJudgeResponse(lastRaw);
    } catch {
      /* tentative suivante */
    }
  }

  return parseJudgeResponse(lastRaw);
}
