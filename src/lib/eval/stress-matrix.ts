import fs from "fs/promises";
import path from "path";

export interface StressProfileRow {
  id: string;
  domain: string;
  expert_tension: string;
  user_constraint: string;
  ambiguity: string;
  instructions: string;
}

export interface StressMatrixFile {
  version: number;
  description?: string;
  profiles: StressProfileRow[];
}

const MATRIX_PATH = path.join(process.cwd(), "scripts", "stress_matrix.json");

export async function loadStressMatrix(): Promise<StressMatrixFile> {
  const raw = await fs.readFile(MATRIX_PATH, "utf-8");
  const data = JSON.parse(raw) as StressMatrixFile;
  if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
    throw new Error("stress_matrix.json : profiles vide ou invalide.");
  }
  return data;
}

/**
 * Message CEO déterministe (pas de LLM générateur) pour reproduire les mêmes scénarios à chaque run.
 */
export function buildDeterministicUserMessage(profile: StressProfileRow): string {
  return `[Scénario d'évaluation — profil ${profile.id}]
Domaine : ${profile.domain}
Tension experts : ${profile.expert_tension}
Contrainte CEO attendue : ${profile.user_constraint}
Ambiguïté : ${profile.ambiguity}

Brief pour le comité d'experts et le Manager :
${profile.instructions}

---
En tant que CEO, je demande une synthèse actionnable pour décider, en respectant strictement toute contrainte de format ou de fond mentionnée ci-dessus.`;
}

export function pickProfilesForRun(
  profiles: StressProfileRow[],
  count: number
): StressProfileRow[] {
  const out: StressProfileRow[] = [];
  for (let i = 0; i < count; i++) {
    out.push(profiles[i % profiles.length]);
  }
  return out;
}
