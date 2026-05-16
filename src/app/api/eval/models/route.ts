import { formatApiError } from "@/lib/utils";
import {
  fetchEvalModelsList,
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
  const provider: EvalLlmProvider | undefined =
    providerParam === "local" ||
    providerParam === "nim" ||
    providerParam === "custom"
      ? providerParam
      : undefined;

  const baseUrl = searchParams.get("baseUrl") ?? undefined;
  const apiKey = searchParams.get("apiKey") ?? undefined;

  try {
    const result = await fetchEvalModelsList({
      provider: provider ?? resolveEvalProvider(),
      baseUrl,
      apiKey,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: formatApiError(err) }, { status: 400 });
  }
}
