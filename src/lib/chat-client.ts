import type {
  ApiConnection,
  EmployeeConfig,
  ManagerConfig,
  EmployeeMemo,
  TokenUsage,
} from "@/types";

interface StreamCallbacks {
  onMemos: (memos: EmployeeMemo[]) => void;
  onContent: (content: string) => void;
  onError: (error: string) => void;
  onDone: (tokenUsage?: TokenUsage) => void;
}

export async function sendChatMessage(
  messages: { role: "user" | "assistant"; content: string }[],
  employees: EmployeeConfig[],
  manager: ManagerConfig,
  connections: ApiConnection[],
  callbacks: StreamCallbacks,
  overrides?: Record<string, string>,
  fastMode?: boolean,
  signal?: AbortSignal
): Promise<void> {
  const payload: Record<string, unknown> = {
    messages,
    employees,
    manager,
    connections,
  };

  if (fastMode) {
    payload.fastMode = true;
  }

  const activeOverrides = overrides
    ? Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim()))
    : undefined;
  if (activeOverrides && Object.keys(activeOverrides).length > 0) {
    payload.overrides = activeOverrides;
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, "").trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);
          switch (event.type) {
            case "memos":
              callbacks.onMemos(event.memos);
              break;
            case "content":
              callbacks.onContent(event.content);
              break;
            case "error":
              callbacks.onError(event.error);
              break;
            case "done":
              callbacks.onDone(event.tokenUsage);
              break;
          }
        } catch {
          // skip malformed events
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      const abortErr = new DOMException("Aborted", "AbortError");
      throw abortErr;
    }
    throw err;
  }
}
