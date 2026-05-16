#!/usr/bin/env python3
"""
Évaluation automatisée Boardroom (LLM-as-a-judge).

Prérequis : .env avec NVIDIA_NIM_API_KEY (+ NVIDIA_NIM_MODEL optionnel).
  npm run dev   # dans un autre terminal
  npm run eval  # ou: python scripts/evaluate_boardroom.py

Par défaut : matrice de stress → pipeline réel (Manager crée l'équipe,
experts répondent, Manager synthétise) → juge. Aucun JSON de config requis.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
load_dotenv(ROOT_DIR / ".env")

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
JUDGE_MODEL = os.environ.get("NVIDIA_NIM_MODEL", "moonshotai/kimi-k2.6")
API_SLEEP_SECONDS = 5
DEFAULT_BOARDROOM_URL = "http://localhost:3000"
OUTPUT_DIR = SCRIPTS_DIR / "eval_runs"
EVAL_CONNECTION_ID = "eval-nim-auto"
DEFAULT_STRESS_MATRIX_PATH = SCRIPTS_DIR / "stress_matrix.json"
DEFAULT_MANAGER_SYSTEM_PROMPT = """Tu es l'Assistant Manager du CEO. Tu reçois les analyses de plusieurs employés experts et tu dois :
1. Synthétiser leurs réponses en une réponse claire et structurée.
2. Identifier les consensus et les divergences entre les employés.
3. Signaler si un employé n'a pas pu répondre (erreur technique).
4. Présenter une recommandation finale au CEO.
Sois concis, professionnel et orienté décision.

PONDÉRATION DES EMPLOYÉS :
- Chaque mémo indique une pondération (1/3, 2/3 ou 3/3).
- 3/3 (Critique) : avis prioritaire. En cas de conflit technique ou de divergence, privilégie cet employé.
- 2/3 (Important) : avis standard, à considérer normalement.
- 1/3 (Consultatif) : avis secondaire, à intégrer sans le mettre en avant.

FORMATAGE OBLIGATOIRE :
- Utilise exclusivement du Markdown standard pour structurer tes réponses.
- Pour les tableaux, utilise UNIQUEMENT la syntaxe Markdown : | Col1 | Col2 | avec |---|---| pour les séparateurs.
- N'utilise JAMAIS de l'art ASCII (┌─┐│└─┘╔═╗║╚═╝ etc.) pour dessiner des tableaux ou des cadres.
- Utilise des listes, titres (##, ###) et **gras** pour hiérarchiser l'information."""

JUDGE_SYSTEM_PROMPT = """Tu es un évaluateur d'algorithme impitoyable. Analyse la [Réponse du Manager] par rapport à la [Requête Utilisateur] et aux [Mémos des Experts].
Évalue les critères suivants avec 1 (Vrai/Succès) ou 0 (Faux/Échec) :
1. omission_critique : Le manager a-t-il ignoré une recommandation majeure présente dans les mémos ?
2. hallucination_produit : Le manager a-t-il inventé ou modifié la posologie ou l'usage d'un produit ?
3. respect_contrainte : Le manager a-t-il respecté la contrainte explicite de l'utilisateur ?

Tu dois uniquement répondre avec un objet JSON valide et rien d'autre :
{"omission_critique": 0, "hallucination_produit": 0, "respect_contrainte": 1, "justification_courte": "..."}"""

GENERATOR_SYSTEM_PROMPT = """Tu es un générateur de données de test synthétiques pour "Boardroom", une app où un Manager IA synthétise les mémos de plusieurs experts pour un CEO.

Pour chaque cas, invente un scénario réaliste (stratégie business, pharma/réglementaire, ops, finance, produit, etc.).

Chaque cas doit contenir :
- "user_query" : la demande du CEO avec UNE contrainte explicite (format, budget, longueur, interdiction, etc.)
- "expert_memos" : 2 à 4 mémos, chacun avec "employee" (ex: "Expert Réglementaire (3/3)") et "content" (recommandations concrètes ; au moins un point critique 3/3)
- "manager_response" : la synthèse finale du Manager en Markdown
- "defect_profile" : UN parmi "clean", "omission_critique", "hallucination_produit", "respect_contrainte"
  - "clean" : réponse exemplaire qui respecte mémos et contrainte
  - "omission_critique" : ignore délibérément une recommandation majeure d'un expert 3/3
  - "hallucination_produit" : invente ou altère posologie, dosage, indication ou usage produit
  - "respect_contrainte" : viole clairement la contrainte explicite du CEO

Varie les defect_profile sur l'ensemble des cas. Les défauts doivent être réalistes, pas caricaturaux.

Réponds UNIQUEMENT avec un JSON valide de la forme :
{"cases": [{"user_query": "...", "expert_memos": [...], "manager_response": "...", "defect_profile": "..."}]}"""

GENERATOR_STRESS_RULES = """
RÈGLES DE STRESS (obligatoires) :
- Interdit : requêtes CEO vagues ou « faciles » sans contrainte mesurable.
- Chaque user_query DOIT contenir au moins une contrainte explicite (format, longueur, budget, mot interdit, délai, périmètre).
- Le user_query doit décrire un contexte où le Manager devra composer des experts en tension (sujet technique, juridique, contradictoire).
- Inclure des détails factuels (chiffres, délais, produits) pour forcer une synthèse exigeante.
- Chaque cas DOIT inclure "stress_profile_id" reprenant exactement l'id assigné dans le brief.
- NE GÉNÈRE PAS d'expert_memos : le Manager Boardroom créera l'équipe et les experts répondront ensuite."""

GENERATOR_LIVE_PROMPT = f"""Tu es un générateur de requêtes CEO pour tester "Boardroom" (Manager + équipe d'experts IA).
{GENERATOR_STRESS_RULES}

Chaque cas contient UNIQUEMENT :
- "stress_profile_id" : id du profil assigné
- "user_query" : la demande complète du CEO (contrainte explicite obligatoire)

Réponds UNIQUEMENT avec :
{{"cases": [{{"stress_profile_id": "...", "user_query": "..."}}]}}"""

GENERATOR_STRESS_SYNTHETIC_EXTRA = """
- "manager_response" : synthèse Markdown (pour mode offline)
- "defect_profile" : clean | omission_critique | hallucination_produit | respect_contrainte
Le defect_profile doit être cohérent avec le profil de stress quand pertinent."""

FIXTURE_CASES: list[dict[str, Any]] = [
    {
        "user_query": (
            "Synthèse pour un test A/B CRM. "
            "Contrainte : aucun achat de licences supplémentaires ce trimestre."
        ),
        "expert_memos": [
            {
                "employee": "Expert Data (3/3)",
                "content": "Segmenter sur comptes actifs (>3 connexions/mois). Durée : 4 semaines min.",
            },
            {
                "employee": "Expert Produit (2/3)",
                "content": "Utiliser uniquement les fonctionnalités du plan actuel.",
            },
        ],
        "manager_response": (
            "## Synthèse\n"
            "- Cohorte : comptes actifs >3 connexions/mois.\n"
            "- Durée : 4 semaines.\n"
            "- Pas d'achat de licences ce trimestre."
        ),
        "defect_profile": "clean",
    },
]

REQUIRED_SCORE_KEYS = ("omission_critique", "hallucination_produit", "respect_contrainte")
DEFECT_PROFILES = frozenset(
    {"clean", "omission_critique", "hallucination_produit", "respect_contrainte"}
)
EMPLOYEE_WEIGHT_RE = re.compile(r"^(.*?)\s*\((\d)/3\)\s*$")
SECRET_KEY_NAMES = frozenset({"apikey", "api_key", "authorization", "x-api-key"})
SECRET_INLINE_RE = [
    (re.compile(r"nvapi-[A-Za-z0-9_-]+"), "nvapi-[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{20,}"), "sk-[REDACTED]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.I), "Bearer [REDACTED]"),
]


def redact_string(text: str) -> str:
    out = text
    for pattern, replacement in SECRET_INLINE_RE:
        out = pattern.sub(replacement, out)
    return out


def redact_for_report(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: (
                "[REDACTED]"
                if k.lower().replace("-", "_") in SECRET_KEY_NAMES
                or k.lower() == "apikey"
                else redact_for_report(v)
            )
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [redact_for_report(item) for item in obj]
    if isinstance(obj, str):
        return redact_string(obj)
    return obj


def inject_api_keys_from_env(config: dict[str, Any]) -> dict[str, Any]:
    """Les clés API ne sont JAMAIS lues depuis un fichier — uniquement .env."""
    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "").strip()
    if not api_key:
        raise ValueError("NVIDIA_NIM_API_KEY manquante dans .env")
    for conn in config.get("connections", []):
        if isinstance(conn, dict):
            file_key = str(conn.get("apiKey", ""))
            if file_key and file_key not in ("VOTRE_CLE_API", "", "${NVIDIA_NIM_API_KEY}"):
                if file_key.startswith("nvapi-") or file_key.startswith("sk-"):
                    print(
                        "  Sécurité : apiKey ignorée dans le fichier config "
                        "(utilisez .env, pas de clé en dur).",
                        file=sys.stderr,
                    )
            conn["apiKey"] = api_key
    return config


def api_sleep() -> None:
    time.sleep(API_SLEEP_SECONDS)


def extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError(f"No JSON object found in model output: {raw[:200]!r}")
    return json.loads(text[start : end + 1])


def chat_completion(
    client: OpenAI,
    *,
    system: str,
    user: str,
    temperature: float = 0.7,
    json_mode: bool = True,
) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    kwargs: dict[str, Any] = {
        "model": JUDGE_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        response = client.chat.completions.create(**kwargs)
    except Exception:
        kwargs.pop("response_format", None)
        response = client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Empty response from model")
    return content


def parse_employee_label(label: str) -> tuple[str, int]:
    match = EMPLOYEE_WEIGHT_RE.match(label.strip())
    if match:
        return match.group(1).strip(), int(match.group(2))
    return label.strip(), 2


def load_stress_matrix(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"Matrice de stress introuvable : {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    profiles = data.get("profiles", data if isinstance(data, list) else None)
    if not isinstance(profiles, list) or not profiles:
        raise ValueError(f"Matrice de stress invalide : {path}")
    for p in profiles:
        if "id" not in p or "instructions" not in p:
            raise ValueError(f"Profil invalide (id/instructions requis) : {p}")
    return profiles


def assign_stress_profiles(
    count: int, profiles: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Répartition cyclique pour couvrir toute la matrice sur N cas."""
    return [profiles[i % len(profiles)] for i in range(count)]


def build_stress_brief(assignments: list[dict[str, Any]]) -> str:
    lines = ["Profils de stress assignés (un cas par profil, dans l'ordre) :\n"]
    for i, profile in enumerate(assignments, start=1):
        lines.append(
            f"--- Cas {i} | stress_profile_id=\"{profile['id']}\" ---\n"
            f"Domaine: {profile.get('domain', '?')} | "
            f"Tension experts: {profile.get('expert_tension', '?')} | "
            f"Contrainte CEO: {profile.get('user_constraint', '?')} | "
            f"Ambiguïté: {profile.get('ambiguity', '?')}\n"
            f"Instructions: {profile['instructions']}\n"
        )
    return "\n".join(lines)


def build_generator_system_prompt(*, live_manager: bool, use_stress: bool) -> str:
    if not use_stress:
        return GENERATOR_LIVE_PROMPT if live_manager else GENERATOR_SYSTEM_PROMPT
    if live_manager:
        return GENERATOR_LIVE_PROMPT
    return (
        f"{GENERATOR_LIVE_PROMPT}\n{GENERATOR_STRESS_SYNTHETIC_EXTRA}\n"
        "Réponds avec cases incluant manager_response et defect_profile."
    )


def validate_case(
    raw: dict[str, Any],
    index: int,
    *,
    require_manager_response: bool = True,
    require_expert_memos: bool = True,
) -> dict[str, Any]:
    if "user_query" not in raw or not raw["user_query"]:
        raise ValueError(f"Cas {index}: champ manquant ou vide 'user_query'")

    memos_raw = raw.get("expert_memos", [])
    expert_memos: list[dict[str, str]] = []
    if memos_raw:
        if not isinstance(memos_raw, list):
            raise ValueError(f"Cas {index}: expert_memos invalide")
        for j, memo in enumerate(memos_raw):
            if not isinstance(memo, dict) or "content" not in memo:
                raise ValueError(f"Cas {index}, mémo {j}: structure invalide")
            expert_memos.append(
                {
                    "employee": str(memo.get("employee", f"Expert {j + 1}")).strip(),
                    "content": str(memo["content"]).strip(),
                }
            )
    elif require_expert_memos:
        raise ValueError(f"Cas {index}: expert_memos doit contenir au moins 2 mémos")

    if require_expert_memos and len(expert_memos) < 2:
        raise ValueError(f"Cas {index}: expert_memos doit contenir au moins 2 mémos")

    manager_response = raw.get("manager_response", "")
    if require_manager_response and not manager_response:
        raise ValueError(f"Cas {index}: champ manquant 'manager_response'")

    profile = raw.get("defect_profile", "unknown")
    if profile not in DEFECT_PROFILES:
        profile = "unknown"

    case: dict[str, Any] = {
        "user_query": str(raw["user_query"]).strip(),
        "expert_memos": expert_memos,
        "manager_response": str(manager_response).strip() if manager_response else "",
        "defect_profile": profile,
    }
    if raw.get("stress_profile_id"):
        case["stress_profile_id"] = str(raw["stress_profile_id"]).strip()
    if raw.get("proposed_team"):
        case["proposed_team"] = raw["proposed_team"]
    return case


def generate_synthetic_cases(
    client: OpenAI,
    count: int,
    *,
    live_manager: bool,
    use_stress: bool,
    stress_matrix_path: Path,
) -> list[dict[str, Any]]:
    mode = "scénarios stress (manager réel)" if live_manager else "cas complets"
    if use_stress:
        mode = f"{mode} + matrice de stress"
    print(f"\n[Génération] {count} {mode}...")

    assignments: list[dict[str, Any]] | None = None
    if use_stress:
        profiles = load_stress_matrix(stress_matrix_path)
        assignments = assign_stress_profiles(count, profiles)
        print(f"  Matrice : {stress_matrix_path.name} ({len(profiles)} profils)")

    system = build_generator_system_prompt(
        live_manager=live_manager, use_stress=use_stress
    )
    user_prompt = f"Génère exactement {count} cas de test pour Boardroom."
    if use_stress and assignments:
        user_prompt += "\n\n" + build_stress_brief(assignments)
    elif not live_manager:
        user_prompt += " Répartis les defect_profile de façon équilibrée."

    raw = chat_completion(
        client, system=system, user=user_prompt, temperature=0.9, json_mode=True
    )
    parsed = extract_json_object(raw)
    cases_raw = parsed.get("cases")
    if not isinstance(cases_raw, list) or not cases_raw:
        raise ValueError("Le générateur n'a pas renvoyé de liste 'cases'")

    cases = [
        validate_case(
            c,
            i + 1,
            require_manager_response=not live_manager,
            require_expert_memos=not live_manager,
        )
        for i, c in enumerate(cases_raw[:count])
    ]

    if use_stress and assignments:
        for i, (case, expected) in enumerate(zip(cases, assignments), start=1):
            got = case.get("stress_profile_id")
            if got and got != expected["id"]:
                print(
                    f"  Avertissement cas {i} : stress_profile_id={got!r}, "
                    f"attendu {expected['id']!r}",
                    file=sys.stderr,
                )
            elif not got:
                case["stress_profile_id"] = expected["id"]

    return cases


def load_cases(path: Path, *, live_manager: bool) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases_raw = data.get("cases", data) if isinstance(data, dict) else data
    if not isinstance(cases_raw, list):
        raise ValueError("Fichier invalide : attendu {'cases': [...]} ou une liste")
    return [
        validate_case(
            c,
            i + 1,
            require_manager_response=not live_manager
            and not bool(c.get("manager_response")),
            require_expert_memos=not live_manager and bool(c.get("expert_memos")),
        )
        for i, c in enumerate(cases_raw)
    ]


def build_config_from_env() -> dict[str, Any]:
    """Config Boardroom entièrement dérivée de .env — zéro fichier JSON requis."""
    api_key = os.environ.get("NVIDIA_NIM_API_KEY", "").strip()
    if not api_key:
        raise ValueError("NVIDIA_NIM_API_KEY manquante dans .env")

    model = os.environ.get("NVIDIA_NIM_MODEL", JUDGE_MODEL).strip()
    base_url = os.environ.get("NVIDIA_NIM_BASE_URL", NVIDIA_BASE_URL).strip()
    system_prompt = os.environ.get(
        "BOARDROOM_MANAGER_PROMPT", DEFAULT_MANAGER_SYSTEM_PROMPT
    ).strip()

    return {
        "manager": {
            "connectionId": EVAL_CONNECTION_ID,
            "modelId": model,
            "systemPrompt": system_prompt,
        },
        "connections": [
            {
                "id": EVAL_CONNECTION_ID,
                "name": "NIM (eval auto)",
                "baseUrl": base_url,
                "apiKey": api_key,
            }
        ],
        "employeeDefaults": {
            "connectionId": EVAL_CONNECTION_ID,
            "modelId": model,
        },
    }


def load_boardroom_config_override(path: Path) -> dict[str, Any]:
    """Override optionnel (structure uniquement — clés API via .env)."""
    raw_text = path.read_text(encoding="utf-8")
    if "nvapi-" in raw_text or re.search(r"sk-[A-Za-z0-9]{20,}", raw_text):
        print(
            f"  ATTENTION : {path.name} semble contenir une clé API en dur. "
            "Retirez-la et utilisez NVIDIA_NIM_API_KEY dans .env.",
            file=sys.stderr,
        )
    config = json.loads(raw_text)
    for key in ("manager", "connections"):
        if key not in config:
            raise ValueError(f"Config invalide : champ '{key}' manquant")

    if "employeeDefaults" not in config and config.get("employees"):
        legacy = config["employees"][0]
        config["employeeDefaults"] = {
            "connectionId": legacy["connectionId"],
            "modelId": legacy["modelId"],
        }

    defaults = config.get("employeeDefaults")
    if not defaults or not defaults.get("connectionId") or not defaults.get("modelId"):
        raise ValueError(
            "Config override invalide : employeeDefaults.connectionId et modelId requis."
        )
    return inject_api_keys_from_env(config)


def resolve_boardroom_config(config_path: Path | None) -> tuple[dict[str, Any], str]:
    if config_path and config_path.is_file():
        return load_boardroom_config_override(config_path), f"override ({config_path.name})"
    return build_config_from_env(), "auto (.env)"


def resolve_case_count(requested: int | None, stress_matrix_path: Path) -> int:
    if requested is not None:
        return requested
    if os.environ.get("EVAL_CASE_COUNT"):
        return int(os.environ["EVAL_CASE_COUNT"])
    try:
        return len(load_stress_matrix(stress_matrix_path))
    except (FileNotFoundError, ValueError):
        return 10


def post_json(
    url: str,
    payload: dict[str, Any],
    *,
    eval_secret: str | None,
    timeout: int = 300,
) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if eval_secret:
        headers["x-boardroom-eval-secret"] = eval_secret
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = redact_string(exc.read().decode("utf-8", errors="replace"))
        raise RuntimeError(f"HTTP {exc.code} {url}: {err_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Impossible de joindre {url} — lancez `npm run dev` ? ({exc.reason})"
        ) from exc


def memos_from_api(
    memos: list[dict[str, Any]], employees: list[dict[str, Any]]
) -> list[dict[str, str]]:
    weight_by_id = {e["id"]: e.get("weight", 2) for e in employees}
    result: list[dict[str, str]] = []
    for m in memos:
        weight = weight_by_id.get(m.get("employeeId"), 2)
        name = m.get("employeeName", "Expert")
        label = f"{name} ({weight}/3)"
        if m.get("error"):
            content = f"[ERREUR] {m['error']}"
        else:
            content = m.get("content") or ""
        result.append({"employee": label, "content": content})
    return result


def run_boardroom_pipeline(
    case: dict[str, Any],
    config: dict[str, Any],
    *,
    base_url: str,
    eval_secret: str | None,
) -> None:
    url = f"{base_url.rstrip('/')}/api/eval/run-case"
    body = post_json(
        url,
        {
            "userMessage": case["user_query"],
            "manager": config["manager"],
            "connections": config["connections"],
            "employeeDefaults": config["employeeDefaults"],
        },
        eval_secret=eval_secret,
        timeout=600,
    )
    if body.get("error") and not body.get("managerResponse"):
        raise RuntimeError(body["error"])

    employees = body.get("employees", [])
    memos = body.get("memos", [])
    case["proposed_team"] = body.get("team", [])
    case["expert_memos"] = memos_from_api(memos, employees)
    case["manager_response"] = body.get("managerResponse", "")
    case["manager_source"] = "boardroom_pipeline"
    if not case["manager_response"]:
        raise RuntimeError("Pipeline Boardroom : managerResponse vide")
    if len(case["expert_memos"]) < 1:
        raise RuntimeError("Pipeline Boardroom : aucun mémo expert")


def hydrate_live_boardroom_pipeline(
    cases: list[dict[str, Any]],
    config: dict[str, Any],
    *,
    base_url: str,
    eval_secret: str | None,
) -> None:
    total = len(cases)
    print(
        f"\n[Pipeline Boardroom] {base_url}/api/eval/run-case\n"
        "  1. Manager compose l'équipe\n"
        "  2. Experts répondent\n"
        "  3. Manager synthétise"
    )
    for index, case in enumerate(cases, start=1):
        if case.get("manager_response") and case.get("expert_memos"):
            continue
        team_hint = ""
        print(f"  Cas {index}/{total}...")
        run_boardroom_pipeline(
            case, config, base_url=base_url, eval_secret=eval_secret
        )
        team = case.get("proposed_team", [])
        if team:
            names = ", ".join(f"{t.get('icon', '')} {t.get('name', '')}" for t in team)
            team_hint = f" → équipe : {names}"
        print(f"    {len(case['expert_memos'])} mémos, synthèse OK{team_hint}")
        if index < total:
            api_sleep()


def save_cases(cases: list[dict[str, Any]], path: Path, *, live_manager: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "pipeline" if live_manager else "offline",
        "model": JUDGE_MODEL,
        "cases": cases,
    }
    path.write_text(
        json.dumps(redact_for_report(payload), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Cas sauvegardés : {path}")


def build_judge_user_message(case: dict[str, Any]) -> str:
    memos_text = "\n\n".join(
        f"### {m.get('employee', 'Expert')}\n{m['content']}"
        for m in case["expert_memos"]
    )
    return (
        f"[Requête Utilisateur]\n{case['user_query']}\n\n"
        f"[Mémos des Experts]\n{memos_text}\n\n"
        f"[Réponse du Manager]\n{case['manager_response']}"
    )


def normalize_scores(parsed: dict[str, Any]) -> dict[str, int]:
    scores: dict[str, int] = {}
    for key in REQUIRED_SCORE_KEYS:
        if key not in parsed:
            raise KeyError(f"Missing key '{key}' in judge response: {parsed}")
        value = parsed[key]
        if isinstance(value, bool):
            scores[key] = int(value)
        elif isinstance(value, (int, float)):
            scores[key] = 1 if int(value) == 1 else 0
        else:
            raise TypeError(f"Invalid type for '{key}': {type(value)}")
    return scores


def call_judge(client: OpenAI, user_message: str) -> dict[str, Any]:
    content = chat_completion(
        client,
        system=JUDGE_SYSTEM_PROMPT,
        user=user_message,
        temperature=0,
        json_mode=True,
    )
    return extract_json_object(content)


def expected_flags(profile: str) -> dict[str, int | None]:
    mapping: dict[str, dict[str, int | None]] = {
        "clean": {
            "omission_critique": 0,
            "hallucination_produit": 0,
            "respect_contrainte": 1,
        },
        "omission_critique": {
            "omission_critique": 1,
            "hallucination_produit": 0,
            "respect_contrainte": None,
        },
        "hallucination_produit": {
            "omission_critique": 0,
            "hallucination_produit": 1,
            "respect_contrainte": None,
        },
        "respect_contrainte": {
            "omission_critique": 0,
            "hallucination_produit": 0,
            "respect_contrainte": 0,
        },
    }
    return mapping.get(profile, {})


def evaluate_all(
    client: OpenAI, cases: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    total = len(cases)

    for index, case in enumerate(cases, start=1):
        profile = case.get("defect_profile", "?")
        stress_id = case.get("stress_profile_id", "—")
        source = case.get("manager_source", "synthetic")
        print(
            f"\n--- Cas {index}/{total} "
            f"(manager: {source}, stress: {stress_id}, defect: {profile}) ---"
        )
        preview = case["user_query"][:80].replace("\n", " ")
        print(f"Requête : {preview}...")

        try:
            parsed = call_judge(client, build_judge_user_message(case))
            scores = normalize_scores(parsed)
            justification = parsed.get("justification_courte", "")
            print(f"Scores juge : {scores}")
            if justification:
                print(f"Justification : {justification}")
            results.append(
                {
                    "case_index": index,
                    "defect_profile": profile,
                    "manager_source": source,
                    "scores": scores,
                    "error": None,
                }
            )
        except Exception as exc:
            print(f"ERREUR cas {index} : {exc}", file=sys.stderr)
            results.append(
                {
                    "case_index": index,
                    "defect_profile": profile,
                    "manager_source": source,
                    "scores": None,
                    "error": str(exc),
                }
            )

        if index < total:
            api_sleep()

    return results


def print_aggregate_report(
    results: list[dict[str, Any]],
    cases: list[dict[str, Any]],
    *,
    live_manager: bool,
) -> None:
    valid_results = [r for r in results if r["scores"] is not None]
    n_valid = len(valid_results)
    n_total = len(results)

    print("\n" + "=" * 50)
    print("RAPPORT D'ÉVALUATION LLM-AS-A-JUDGE")
    if live_manager:
        print("(Pipeline Boardroom : équipe + experts + synthèse)")
    print("=" * 50)

    if n_valid == 0:
        print("Aucun cas évalué avec succès.")
        return

    def rate(key: str) -> float:
        return 100.0 * sum(r["scores"][key] for r in valid_results) / n_valid

    print(f"Cas évalués : {n_valid}/{n_total}")
    print(f"Taux d'omission critique : {rate('omission_critique'):.0f}%")
    print(f"Taux d'hallucination produit : {rate('hallucination_produit'):.0f}%")
    print(f"Taux de respect des contraintes : {rate('respect_contrainte'):.0f}%")

    if not live_manager:
        aligned = 0
        comparable = 0
        for r, case in zip(results, cases):
            if r["scores"] is None:
                continue
            expected = expected_flags(case.get("defect_profile", ""))
            if not expected:
                continue
            for key, exp in expected.items():
                if exp is None:
                    continue
                comparable += 1
                if r["scores"][key] == exp:
                    aligned += 1
        if comparable:
            print(
                f"Cohérence juge / profil synthétique : "
                f"{100.0 * aligned / comparable:.0f}% ({aligned}/{comparable} critères)"
            )

    if n_valid < n_total:
        print(f"\n({n_total - n_valid} cas en échec, exclus du calcul)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Éval Boardroom automatisée (stress + pipeline réel + juge)"
    )
    parser.add_argument(
        "-n",
        "--count",
        type=int,
        default=None,
        help="Nombre de cas (défaut: taille de stress_matrix.json)",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Mode hors-ligne (manager fictif) — déconseillé, masque les vrais défauts",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Override JSON optionnel (sinon tout est lu depuis .env)",
    )
    parser.add_argument(
        "--boardroom-url",
        default=os.environ.get("BOARDROOM_URL", DEFAULT_BOARDROOM_URL),
        help=f"URL de l'app Next.js (défaut: {DEFAULT_BOARDROOM_URL})",
    )
    parser.add_argument(
        "--fixtures",
        action="store_true",
        help="Utiliser le mini-jeu statique (sans génération IA)",
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Charger des cas depuis un JSON (skip génération)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Sauvegarder les cas générés (défaut: scripts/eval_runs/<timestamp>.json)",
    )
    parser.add_argument(
        "--generate-only",
        action="store_true",
        help="Générer et sauvegarder les cas sans lancer le juge",
    )
    parser.add_argument(
        "--no-stress",
        action="store_true",
        help="[Déconseillé] Désactive la matrice de stress (happy path)",
    )
    parser.add_argument(
        "--stress-matrix",
        type=Path,
        default=DEFAULT_STRESS_MATRIX_PATH,
        help="Fichier JSON des profils de stress",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    eval_secret = os.environ.get("BOARDROOM_EVAL_SECRET")
    live_pipeline = not args.offline
    use_stress = not args.no_stress

    if args.no_stress:
        print(
            "ATTENTION : --no-stress active le happy path (scénarios faciles).",
            file=sys.stderr,
        )

    api_key = os.environ.get("NVIDIA_NIM_API_KEY")
    if not api_key:
        print(
            "NVIDIA_NIM_API_KEY manquante — ajoutez-la dans .env à la racine.",
            file=sys.stderr,
        )
        return 1

    nim_base = os.environ.get("NVIDIA_NIM_BASE_URL", NVIDIA_BASE_URL)
    client = OpenAI(api_key=api_key, base_url=nim_base)
    case_count = resolve_case_count(args.count, args.stress_matrix)

    print(f"Modèle NIM : {JUDGE_MODEL}")
    print(f"Cas à exécuter : {case_count}" + (" (matrice de stress)" if use_stress else ""))
    print(f"Mode : {'pipeline Boardroom réel' if live_pipeline else 'offline (fictif)'}")
    print(f"Pause API : {API_SLEEP_SECONDS}s entre chaque appel")

    boardroom_config: dict[str, Any] | None = None
    config_source = ""
    if live_pipeline:
        try:
            config_path = args.config
            if config_path is None and os.environ.get("BOARDROOM_EVAL_CONFIG"):
                config_path = Path(os.environ["BOARDROOM_EVAL_CONFIG"])
            boardroom_config, config_source = resolve_boardroom_config(config_path)
        except ValueError as exc:
            print(exc, file=sys.stderr)
            return 1
        model = boardroom_config["manager"]["modelId"]
        print(f"Boardroom : {args.boardroom_url} | config {config_source} | modèle {model}")

    if args.input:
        cases = load_cases(args.input, live_manager=live_pipeline)
        print(f"Chargé {len(cases)} cas depuis {args.input}")
    elif args.fixtures:
        cases = [
            validate_case(
                c,
                i + 1,
                require_manager_response=not live_pipeline,
                require_expert_memos=not live_pipeline,
            )
            for i, c in enumerate(FIXTURE_CASES)
        ]
        print(f"Mode fixtures : {len(cases)} cas statiques")
    else:
        if use_stress:
            try:
                load_stress_matrix(args.stress_matrix)
            except (FileNotFoundError, ValueError) as exc:
                print(exc, file=sys.stderr)
                return 1
        try:
            cases = generate_synthetic_cases(
                client,
                case_count,
                live_manager=live_pipeline,
                use_stress=use_stress,
                stress_matrix_path=args.stress_matrix,
            )
        except (FileNotFoundError, ValueError) as exc:
            print(exc, file=sys.stderr)
            return 1
        api_sleep()
        out = args.output or OUTPUT_DIR / f"{datetime.now():%Y%m%d_%H%M%S}.json"
        save_cases(cases, out, live_manager=live_pipeline)

    if live_pipeline and boardroom_config:
        hydrate_live_boardroom_pipeline(
            cases,
            boardroom_config,
            base_url=args.boardroom_url,
            eval_secret=eval_secret,
        )
        if not args.generate_only:
            api_sleep()

    if args.generate_only:
        print("Génération terminée (--generate-only).")
        return 0

    for case in cases:
        if not case.get("manager_response"):
            print(
                "Cas sans manager_response : lancez sans --offline avec `npm run dev`.",
                file=sys.stderr,
            )
            return 1

    results = evaluate_all(client, cases)
    print_aggregate_report(results, cases, live_manager=live_pipeline)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = OUTPUT_DIR / f"{stamp}.report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(
            redact_for_report(
                {
                    "mode": "pipeline" if live_pipeline else "offline",
                    "model": JUDGE_MODEL,
                    "stress_matrix": use_stress,
                    "boardroom_url": args.boardroom_url if live_pipeline else None,
                    "config_source": config_source if live_pipeline else None,
                    "results": results,
                    "cases": cases,
                }
            ),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nRapport détaillé : {report_path}")
    if live_pipeline:
        print(f"Dashboard : {args.boardroom_url.rstrip('/')}/eval")

    return 0 if all(r["scores"] is not None for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
