import { formatApiError } from "@/lib/utils";
import {
  fetchEvalModelsList,
  normalizeEvalBaseUrl,
  resolveEvalProvider,
  type EvalLlmProvider,
} from "@/lib/eval/llm-config";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Disponible uniquement en développement." },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const providerParam = searchParams.get("provider");
  const provider: EvalLlmProvider =
    providerParam === "local" ||
    providerParam === "nim" ||
    providerParam === "custom"
      ? providerParam
      : resolveEvalProvider();

  const rawBase = searchParams.get("baseUrl")?.trim() ?? "";
  const baseUrl = rawBase
    ? normalizeEvalBaseUrl(rawBase, provider)
    : undefined;
  const apiKey = searchParams.get("apiKey") ?? undefined;

  try {
    const result = await fetchEvalModelsList({ provider, baseUrl, apiKey });
    const ok = !result.fetchError;
    return Response.json({
      ok,
      provider: result.provider,
      baseUrl: result.baseUrl,
      defaultModel: result.defaultModel,
      modelCount: result.models.length,
      fetchError: result.fetchError,
      hint: ok
        ? "Connexion OK depuis le serveur Next.js."
        : formatApiError(new Error(result.fetchError ?? "Échec")),
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: formatApiError(err) },
      { status: 400 }
    );
  }
}
