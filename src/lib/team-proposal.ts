import OpenAI from "openai";
import {
  extractAssistantTextForParsing,
  stripJsonFences,
  stripThinkingTags,
} from "@/lib/synthesis";
import type { ApiConnection, ManagerConfig, ProposedEmployee } from "@/types";

const EVAL_PROMPT_MAX = 2_500;

export function buildProposalPrompt(userPrompt: string): string {
  const brief =
    userPrompt.length > EVAL_PROMPT_MAX
      ? `${userPrompt.slice(0, EVAL_PROMPT_MAX)}\n[… brief tronqué …]`
      : userPrompt;

  return `Tu es le Manager. Compose exactement 3 experts pour ce brief CEO.

Brief :
"${brief}"

Réponds UNIQUEMENT avec cet objet JSON (pas de markdown, pas de texte avant/après) :
{"experts":[{"name":"Titre court","icon":"🎯","systemPrompt":"Tu es expert en X. Réponds au CEO en Markdown (titres, listes). Pas d'art ASCII.","justification":"Une phrase."},{"name":"...","icon":"📊","systemPrompt":"...","justification":"..."},{"name":"...","icon":"⚖️","systemPrompt":"...","justification":"..."}]}`;
}

/** Équipe minimale si le modèle local ne renvoie pas de JSON valide (eval uniquement). */
export function buildEvalFallbackTeam(userPrompt: string): ProposedEmployee[] {
  const domain =
    userPrompt.match(/Domaine\s*:\s*([^\n]+)/i)?.[1]?.trim() ?? "général";
  return [
    {
      name: "Analyste métier",
      icon: "📊",
      systemPrompt: `Tu es analyste senior (${domain}). Analyse le brief CEO et recommande des actions concrètes. Réponds en Markdown structuré.`,
      justification: "Couverture métier du domaine.",
      accepted: true,
      weight: 2,
    },
    {
      name: "Expert conformité",
      icon: "⚖️",
      systemPrompt: `Tu es expert conformité et risques (${domain}). Identifie les contraintes réglementaires et les risques. Réponds en Markdown.`,
      justification: "Vérification des contraintes du brief.",
      accepted: true,
      weight: 2,
    },
    {
      name: "Stratège synthèse",
      icon: "🎯",
      systemPrompt: `Tu es stratège. Propose une recommandation décisionnelle pour le CEO à partir du domaine ${domain}. Réponds en Markdown, sois actionnable.`,
      justification: "Recommandation finale actionnable.",
      accepted: true,
      weight: 2,
    },
  ];
}

function mapExpertItems(items: unknown[]): ProposedEmployee[] {
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .filter(
      (item) =>
        typeof item.name === "string" &&
        typeof item.systemPrompt === "string" &&
        item.systemPrompt &&
        (typeof item.justification === "string" || typeof item.justification === "undefined")
    )
    .map((item) => ({
      name: item.name as string,
      icon: typeof item.icon === "string" ? item.icon : "🧑‍💼",
      systemPrompt: item.systemPrompt as string,
      justification:
        typeof item.justification === "string"
          ? item.justification
          : "Expert requis pour le brief.",
      accepted: true,
      weight: 2 as const,
    }));
}

function extractExpertArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  for (const key of ["experts", "team", "employees", "members"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  return null;
}

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

function extractBalancedJsonArray(text: string): string | null {
  const start = text.indexOf("[");
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
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseProposalResponse(raw: string): ProposedEmployee[] {
  const cleaned = stripJsonFences(stripThinkingTags(raw));
  if (!cleaned) return [];

  const attempts: string[] = [cleaned];
  const obj = extractBalancedJsonObject(cleaned);
  if (obj) attempts.push(obj);
  const arr = extractBalancedJsonArray(cleaned);
  if (arr) attempts.push(arr);

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const expertArr = extractExpertArray(parsed);
      if (expertArr?.length) {
        const mapped = mapExpertItems(expertArr);
        if (mapped.length) return mapped;
      }
    } catch {
      /* essai suivant */
    }
  }

  return [];
}

async function requestTeamJson(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  signal?: AbortSignal,
  useJsonObject = false
): Promise<string> {
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    temperature: 0.1,
    max_tokens: 2048,
    messages,
  };
  if (useJsonObject) {
    body.response_format = { type: "json_object" };
  }

  const response = await client.chat.completions.create(body, { signal });
  return extractAssistantTextForParsing(response.choices[0]?.message);
}

export async function proposeTeam(params: {
  prompt: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
  signal?: AbortSignal;
  /** En eval : équipe par défaut si le modèle local échoue (JSON vide / invalide). */
  evalFallback?: boolean;
}): Promise<{ team: ProposedEmployee[]; usedFallback: boolean }> {
  const { prompt, manager, connections, signal, evalFallback } = params;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const conn = connections.find((c) => c.id === manager.connectionId);
  if (!conn) {
    throw new Error("Connexion du Manager introuvable.");
  }

  const client = new OpenAI({
    baseURL: conn.baseUrl,
    apiKey: conn.apiKey,
  });

  const systemMsg =
    "Tu réponds UNIQUEMENT en JSON valide. Aucun markdown, aucun texte hors JSON.";

  const attempts: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    jsonObject: boolean;
  }[] = [
    {
      jsonObject: true,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: buildProposalPrompt(prompt) },
      ],
    },
    {
      jsonObject: false,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: buildProposalPrompt(prompt) },
      ],
    },
    {
      jsonObject: true,
      messages: [
        { role: "system", content: systemMsg },
        {
          role: "user",
          content: `JSON uniquement, clé "experts", 3 membres :
{"experts":[{"name":"Expert A","icon":"🎯","systemPrompt":"Tu es... Markdown.","justification":"..."},{"name":"Expert B","icon":"📊","systemPrompt":"...","justification":"..."},{"name":"Expert C","icon":"⚖️","systemPrompt":"...","justification":"..."}]}`,
        },
      ],
    },
  ];

  let lastRaw = "";
  for (const attempt of attempts) {
    try {
      lastRaw = await requestTeamJson(
        client,
        manager.modelId,
        attempt.messages,
        signal,
        attempt.jsonObject
      );
    } catch (err) {
      if (attempt.jsonObject) continue;
      throw err;
    }
    const proposed = parseProposalResponse(lastRaw);
    if (proposed.length > 0) {
      return { team: proposed, usedFallback: false };
    }
  }

  if (evalFallback) {
    return { team: buildEvalFallbackTeam(prompt), usedFallback: true };
  }

  const excerpt = stripThinkingTags(lastRaw).slice(0, 280).replace(/\s+/g, " ");
  throw new Error(
    excerpt
      ? `Le Manager n'a pas pu proposer d'équipe (réponse vide ou JSON invalide). Extrait : « ${excerpt}… »`
      : "Le Manager n'a pas pu proposer d'équipe (réponse vide). Vérifiez que le modèle est chargé dans LM Studio."
  );
}
