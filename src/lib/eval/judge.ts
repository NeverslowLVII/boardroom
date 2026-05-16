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

const JUDGE_SYSTEM = `Tu es un évaluateur rigoureux.

Le message utilisateur contient trois blocs XML : <requete_utilisateur>, <memos_experts> et <reponse_du_manager>.

Évalue UNIQUEMENT le contenu à l'intérieur de <reponse_du_manager>, en le comparant à <requete_utilisateur> et à <memos_experts>. Ignore tout texte hors de ces balises.

Si <reponse_du_manager> est vide ou quasi vide, considère que la synthèse a échoué (limite de contexte ou erreur API) — ne pénalise pas une « omission » sur du contenu qui n'a jamais été généré.

Critères (1 = succès, 0 = échec) :
1. omission_critique : la réponse a-t-elle ignoré une recommandation majeure présente dans les mémos ?
2. hallucination_produit : la réponse a-t-elle inventé ou altéré des faits, formulations ou éléments concrets explicitement présents dans les mémos ?
3. respect_contrainte : la réponse a-t-elle respecté la contrainte explicite de l'utilisateur dans <requete_utilisateur> ?

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour :
{"omission_critique":0,"hallucination_produit":0,"respect_contrainte":1,"justification_courte":"..."}`;

/**
 * Plafond optionnel sur l'entrée du juge (caractères).
 * 0 ou absent = pas de troncature (recommandé). Le juge voit le texte complet.
 */
function judgeMaxInputChars(): number {
  const raw = process.env.JUDGE_MAX_INPUT_CHARS;
  if (raw === undefined || raw === "" || raw === "0") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function capJudgeInputIfConfigured(text: string): string {
  const max = judgeMaxInputChars();
  if (max <= 0 || text.length <= max) return text;
  const head = Math.floor(max * 0.45);
  const tail = max - head - 120;
  return `${text.slice(0, head)}\n\n[… segment central omis (${text.length - head - tail} car.) — définir JUDGE_MAX_INPUT_CHARS=0 pour désactiver …]\n\n${text.slice(-tail)}`;
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

export function buildJudgeUserContent(params: {
  userMessage: string;
  expertMemos: { employeeName: string; content: string }[];
  managerResponse: string;
}): string {
  const memosText = params.expertMemos
    .map((m) => `### ${m.employeeName}\n${m.content}`)
    .join("\n\n");

  return `<requete_utilisateur>
${params.userMessage}
</requete_utilisateur>

<memos_experts>
${memosText}
</memos_experts>

<reponse_du_manager>
${params.managerResponse}
</reponse_du_manager>`;
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
    max_tokens: 1024,
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

  if (!params.managerResponse.trim()) {
    throw new Error(
      "Synthèse vide : impossible de juger (vérifiez la fenêtre de contexte du modèle de synthèse)."
    );
  }

  const userContent = capJudgeInputIfConfigured(
    buildJudgeUserContent(params)
  );

  const client = new OpenAI({
    baseURL: params.baseUrl,
    apiKey: params.apiKey,
  });

  const { signal } = params;
  const attempts: { jsonObject: boolean }[] = [
    { jsonObject: true },
    { jsonObject: false },
  ];

  let lastRaw = "";
  for (const attempt of attempts) {
    try {
      lastRaw = await callJudge(
        client,
        params.model,
        JUDGE_SYSTEM,
        userContent,
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
