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
 * Message utilisateur déterministe (pas de LLM générateur) pour reproduire les mêmes scénarios à chaque run.
 */
export function buildDeterministicUserMessage(profile: StressProfileRow): string {
  return `[Scénario d'évaluation — profil ${profile.id}]
Domaine : ${profile.domain}
Tension entre contributeurs : ${profile.expert_tension}
Contrainte utilisateur attendue : ${profile.user_constraint}
Ambiguïté : ${profile.ambiguity}

Brief pour les contributeurs et l'assistant de synthèse :
${profile.instructions}

---
En tant qu'utilisateur, je demande une synthèse actionnable, en respectant strictement toute contrainte de format ou de fond mentionnée ci-dessus.`;
}

function shuffleProfiles<T>(items: T[]): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/** Profils tirés au hasard (évite de rejouer toujours le 1er du fichier, ex. pharma_reg_vs_commercial). */
export function pickProfilesForRun(
  profiles: StressProfileRow[],
  count: number
): StressProfileRow[] {
  const pool = shuffleProfiles(profiles);
  const out: StressProfileRow[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[i % pool.length]);
  }
  return out;
}
