import { NextRequest } from "next/server";

const TIMEOUT_MS = 15_000;

interface ModelsResponse {
  data: { id: string; owned_by?: string }[];
}

async function fetchModelsFromConnection(conn: {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = conn.baseUrl.replace(/\/+$/, "") + "/models";

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        connectionId: conn.id,
        models: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const json: ModelsResponse = await res.json();
    const seen = new Set<string>();
    const models = (json.data ?? [])
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .map((m) => ({
        id: m.id,
        ownedBy: m.owned_by ?? "",
        connectionId: conn.id,
        connectionName: conn.name,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    return { connectionId: conn.id, models, error: null };
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? `Timeout (${TIMEOUT_MS / 1000}s) — vérifiez l'URL`
        : err instanceof Error
          ? err.message
          : "Erreur inconnue";

    return { connectionId: conn.id, models: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { connections } = await request.json();

    if (!Array.isArray(connections) || connections.length === 0) {
      return Response.json(
        { error: "Aucune connexion fournie." },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      connections.map(fetchModelsFromConnection)
    );

    const allModels = results.flatMap((r) => r.models);
    const errors = results
      .filter((r) => r.error)
      .map((r) => ({ connectionId: r.connectionId, error: r.error }));

    return Response.json({ models: allModels, errors });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Erreur serveur.",
      },
      { status: 500 }
    );
  }
}
