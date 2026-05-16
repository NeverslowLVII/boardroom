import fs from "fs/promises";
import path from "path";

const DEFAULT_DATASET_PATH = path.join(
  process.cwd(),
  "scripts",
  "data",
  "real_queries.jsonl"
);

export async function loadWildchatQueries(
  filePath: string = DEFAULT_DATASET_PATH
): Promise<string[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  const queries: string[] = [];
  for (const line of raw.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    const value = JSON.parse(stripped) as unknown;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Ligne JSONL invalide dans ${filePath}`);
    }
    queries.push(value.trim());
  }
  if (queries.length === 0) {
    throw new Error(`Dataset vide : ${filePath}`);
  }
  return queries;
}

/** Tirage aléatoire sans remplacement (puis complète si count > pool). */
export function sampleWildchatQueries(
  pool: string[],
  count: number
): string[] {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(shuffled[i % shuffled.length]);
  }
  return out;
}

export { DEFAULT_DATASET_PATH };
