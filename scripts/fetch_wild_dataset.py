#!/usr/bin/env python3
"""
Extrait des prompts humains réels depuis allenai/WildChat (HuggingFace)
pour alimenter l'évaluation Boardroom.

Sorties :
  - scripts/data/real_queries.json   → tableau JSON compact (spec)
  - scripts/data/real_queries.jsonl → 1 requête par ligne (lecture humaine)

Usage (Windows — le launcher `py` est souvent requis) :
  py -3 -m pip install -r scripts/requirements.txt
  py -3 scripts/fetch_wild_dataset.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from datasets import load_dataset

TARGET_COUNT = 100
MIN_PROMPT_LENGTH = 150
MAX_PROMPT_LENGTH = 6_000

DECISION_KEYWORDS = [
    "budget",
    "stratégie",
    "strategie",
    "strategy",
    "équipe",
    "equipe",
    "team",
    "manager",
    "management",
    "client",
    "clients",
    "déploiement",
    "deploiement",
    "deployment",
    "conflit",
    "conflict",
    "projet",
    "project",
    "décision",
    "decision",
    "roadmap",
    "kpi",
    "roi",
    "investissement",
    "investment",
    "recrutement",
    "hiring",
    "merger",
    "fusion",
    "pivot",
    "stakeholder",
    "parties prenantes",
    "concurrent",
    "competitor",
    "marché",
    "market",
    "revenue",
    "chiffre",
    "organigramme",
    "priorité",
    "priorite",
    "priority",
    "entreprise",
    "business",
    "startup",
    "contrat",
    "négociation",
    "negociation",
    "conseil",
    "board",
    "comité",
    "comite",
]

# Bruit fréquent dans WildChat (templates AutoGPT, RP, code, images…)
EXCLUDE_PATTERNS = [
    r"\bCONSTRAINTS\s*:",
    r"\bRESPONSE FORMAT\s*:",
    r"\bCOMMANDS\s*:",
    r"you should only respond in json",
    r"\bact as (a|an)\b",
    r"stable diffusion",
    r"write a detailed (and exciting )?story",
    r"write this global politics",
    r"^import (streamlit|cv2|pandas)\b",
    r"```",
    r"father gpt",
    r"message_father",
    r"king of fighters",
    r"cheerleader",
    r"stable diffusion promts",
    r"disney man",
    r"roleplay",
    r"fiction",
    r"squeezing .{0,40} legs",
    r"promts young",
    r"openai\.ChatCompletion",
    r"KeyError Traceback",
    r"PRESIDIO_ANONYMIZED",
]

EXCLUDE_RE = re.compile("|".join(EXCLUDE_PATTERNS), re.IGNORECASE | re.DOTALL)

SCRIPTS_DIR = Path(__file__).resolve().parent
OUTPUT_JSON = SCRIPTS_DIR / "data" / "real_queries.json"
OUTPUT_JSONL = SCRIPTS_DIR / "data" / "real_queries.jsonl"


def extract_first_user_message(row: dict) -> str | None:
    conversation = row.get("conversation")
    if not conversation or not isinstance(conversation, list):
        return None

    for turn in conversation:
        if not isinstance(turn, dict):
            continue
        role = (turn.get("role") or "").lower()
        if role and role not in ("user", "human"):
            continue
        content = turn.get("content") or turn.get("text")
        if isinstance(content, str) and content.strip():
            return content.strip()

    first = conversation[0]
    if not isinstance(first, dict):
        return None
    content = first.get("content") or first.get("text")
    if isinstance(content, str) and content.strip():
        return content.strip()
    return None


def normalize_for_dedup(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def contains_decision_keyword(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in DECISION_KEYWORDS)


def passes_language_filter(row: dict, text: str) -> bool:
    language = (row.get("language") or "").strip()
    if language == "French":
        return True
    return contains_decision_keyword(text)


def looks_like_boardroom_query(text: str) -> bool:
    if EXCLUDE_RE.search(text):
        return False
    # Trop de structure « prompt système »
    if text.count("\n") > 40 and text[:200].upper().count(":") > 5:
        return False
    return True


def is_valid_query(row: dict, text: str) -> bool:
    if len(text) <= MIN_PROMPT_LENGTH or len(text) > MAX_PROMPT_LENGTH:
        return False
    if not contains_decision_keyword(text):
        return False
    if not passes_language_filter(row, text):
        return False
    if not looks_like_boardroom_query(text):
        return False
    return True


def save_outputs(queries: list[str]) -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    OUTPUT_JSON.write_text(
        json.dumps(queries, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    OUTPUT_JSONL.write_text(
        "\n".join(json.dumps(q, ensure_ascii=False) for q in queries) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    collected: list[str] = []
    seen: set[str] = set()
    scanned = 0

    print("Recherche de requêtes Boardroom (WildChat)…")
    print(f"Objectif : {TARGET_COUNT} requêtes → {OUTPUT_JSON}")
    print(f"Lecture humaine : {OUTPUT_JSONL} (1 requête par ligne)")

    try:
        dataset = load_dataset("allenai/WildChat", split="train", streaming=True)
    except Exception as exc:
        print(f"Erreur lors du chargement du dataset : {exc}", file=sys.stderr)
        return 1

    for row in dataset:
        scanned += 1
        if scanned % 500 == 0:
            print(f"  … {scanned} lignes parcourues, {len(collected)}/{TARGET_COUNT} retenues")

        text = extract_first_user_message(row)
        if not text:
            continue

        key = normalize_for_dedup(text)
        if key in seen:
            continue

        if not is_valid_query(row, text):
            continue

        seen.add(key)
        collected.append(text)
        preview = text.replace("\n", " ")[:80]
        print(f"Trouvé {len(collected)}/{TARGET_COUNT} — {preview}…")

        if len(collected) >= TARGET_COUNT:
            break

    if len(collected) < TARGET_COUNT:
        print(
            f"\nAttention : seulement {len(collected)}/{TARGET_COUNT} requêtes "
            f"après {scanned} lignes parcourues.",
            file=sys.stderr,
        )

    save_outputs(collected)
    lengths = [len(q) for q in collected]
    print(
        f"\nTerminé : {len(collected)} requêtes "
        f"(longueur {min(lengths)}–{max(lengths)} car.)"
    )
    print(f"  JSON  : {OUTPUT_JSON}")
    print(f"  JSONL : {OUTPUT_JSONL}")
    return 0 if collected else 1


if __name__ == "__main__":
    raise SystemExit(main())
