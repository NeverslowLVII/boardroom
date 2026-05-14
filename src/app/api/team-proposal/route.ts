import { NextRequest } from "next/server";
import OpenAI from "openai";
import type {
  ApiConnection,
  ManagerConfig,
  ProposedEmployee,
} from "@/types";

interface ProposalPayload {
  prompt: string;
  manager: ManagerConfig;
  connections: ApiConnection[];
}

function buildProposalPrompt(userPrompt: string): string {
  return `Tu es le Manager d'une équipe d'experts IA. Le CEO vient de poser cette question :

"${userPrompt}"

Ta mission : compose une équipe de 3 à 5 experts parfaitement adaptés à cette demande.

Pour chaque expert, tu dois créer :
- "name" : un titre de poste court et descriptif (ex: "Analyste Financier", "Expert Sécurité", "Stratège Marketing")
- "icon" : un seul emoji représentant le rôle
- "systemPrompt" : un system prompt complet et détaillé (3-6 lignes) qui définit précisément l'expertise, l'angle d'analyse et le style de réponse de cet expert. Ce prompt sera envoyé tel quel au modèle. IMPORTANT : chaque system prompt DOIT inclure l'instruction de formater en Markdown standard (titres, listes, tableaux avec | col | col |) et JAMAIS en art ASCII.
- "justification" : une phrase expliquant pourquoi cet expert est nécessaire pour cette demande spécifique

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans explication, dans ce format exact :
[
  {
    "name": "Titre du poste",
    "icon": "🎯",
    "systemPrompt": "Tu es un expert en... Ton rôle est de...",
    "justification": "Nécessaire parce que..."
  }
]`;
}

function parseProposalResponse(raw: string): ProposedEmployee[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: Record<string, unknown>) =>
          typeof item.name === "string" &&
          typeof item.systemPrompt === "string" &&
          item.systemPrompt &&
          typeof item.justification === "string"
      )
      .map((item: { name: string; icon?: string; systemPrompt: string; justification: string }) => ({
        name: item.name,
        icon: typeof item.icon === "string" ? item.icon : "🧑‍💼",
        systemPrompt: item.systemPrompt,
        justification: item.justification,
        accepted: true,
        weight: 2 as const,
      }));
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ProposalPayload = await request.json();
    const { prompt, manager, connections } = body;

    const conn = connections.find((c) => c.id === manager.connectionId);
    if (!conn) {
      return Response.json(
        { error: "Connexion du Manager introuvable." },
        { status: 400 }
      );
    }

    const client = new OpenAI({
      baseURL: conn.baseUrl,
      apiKey: conn.apiKey,
    });

    const response = await client.chat.completions.create({
      model: manager.modelId,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant qui répond UNIQUEMENT en JSON valide. Pas de markdown, pas de texte autour.",
        },
        {
          role: "user",
          content: buildProposalPrompt(prompt),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const cleanRaw = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const proposed = parseProposalResponse(cleanRaw);

    if (proposed.length === 0) {
      return Response.json(
        {
          error:
            "Le Manager n'a pas pu proposer d'équipe. Réessayez ou vérifiez la configuration du Manager.",
        },
        { status: 422 }
      );
    }

    return Response.json({ team: proposed });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Erreur serveur.",
      },
      { status: 500 }
    );
  }
}
