export class EvalAbortedError extends Error {
  constructor(message = "Évaluation annulée.") {
    super(message);
    this.name = "EvalAbortedError";
  }
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof EvalAbortedError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    const msg = err.message.toLowerCase();
    if (msg.includes("aborted") || msg.includes("abort")) return true;
  }
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new EvalAbortedError();
  }
}

export function sleepInterruptible(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  throwIfAborted(signal);
  if (!signal) {
    return new Promise((r) => setTimeout(r, ms));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new EvalAbortedError());
    };
    signal.addEventListener("abort", onAbort);
  });
}
