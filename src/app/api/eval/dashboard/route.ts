import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

const EVAL_DIR = path.join(process.cwd(), "scripts", "eval_runs");

function isSafeBasename(file: string): boolean {
  if (!file.endsWith(".json")) return false;
  if (file.length > 256 || file.includes("..")) return false;
  return /^[a-zA-Z0-9_.-]+$/.test(file);
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Le dashboard fichier est disponible uniquement en développement." },
      { status: 404 }
    );
  }

  const name = request.nextUrl.searchParams.get("file");

  try {
    if (!name) {
      let entries: string[] = [];
      try {
        const list = await fs.readdir(EVAL_DIR);
        entries = list.filter((f) => f.endsWith(".report.json"));
      } catch {
        entries = [];
      }

      const withStats = await Promise.all(
        entries.map(async (f) => {
          try {
            const st = await fs.stat(path.join(EVAL_DIR, f));
            return { name: f, mtimeMs: st.mtimeMs };
          } catch {
            return { name: f, mtimeMs: 0 };
          }
        })
      );

      withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return Response.json({ reports: withStats });
    }

    if (!isSafeBasename(name)) {
      return Response.json({ error: "Nom de fichier invalide." }, { status: 400 });
    }

    const fullPath = path.join(EVAL_DIR, path.basename(name));
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Response.json(parsed);
  } catch {
    return Response.json({ error: "Fichier introuvable ou illisible." }, { status: 404 });
  }
}
