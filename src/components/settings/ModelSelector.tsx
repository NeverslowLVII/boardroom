"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FetchedModel } from "@/types";

interface ModelSelectorProps {
  models: FetchedModel[];
  connectionId: string;
  modelId: string;
  onSelect: (connectionId: string, modelId: string) => void;
}

export function ModelSelector({
  models,
  connectionId,
  modelId,
  onSelect,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.connectionName.toLowerCase().includes(q) ||
        m.ownedBy.toLowerCase().includes(q)
    );
  }, [models, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, { connectionName: string; models: FetchedModel[] }> = {};
    for (const m of filtered) {
      if (!groups[m.connectionId]) {
        groups[m.connectionId] = { connectionName: m.connectionName, models: [] };
      }
      groups[m.connectionId].models.push(m);
    }
    return groups;
  }, [filtered]);

  const selectedModel = models.find(
    (m) => m.id === modelId && m.connectionId === connectionId
  );

  const displayLabel = selectedModel
    ? `${selectedModel.id}`
    : modelId || "Sélectionner un modèle...";

  const displaySub = selectedModel ? selectedModel.connectionName : "";

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-zinc-400">
        Modèle
      </label>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
          "border-zinc-800 bg-zinc-950",
          "hover:border-zinc-700",
          !selectedModel && !modelId && "text-zinc-400"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-zinc-200">
            {displayLabel}
          </div>
          {displaySub && (
            <div className="truncate text-xs text-zinc-400">{displaySub}</div>
          )}
        </div>
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 text-zinc-400 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un modèle..."
              className="flex-1 bg-transparent text-[13px] text-zinc-200 outline-none placeholder:text-zinc-400"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-zinc-400 hover:text-zinc-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {models.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-400">
                Aucun modèle disponible. Ajoutez une connexion API puis cliquez
                &quot;Récupérer les modèles&quot;.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-zinc-400">
                Aucun résultat pour &quot;{search}&quot;
              </div>
            ) : (
              Object.entries(grouped).map(([connId, group]) => (
                <div key={connId}>
                  <div className="sticky top-0 bg-zinc-900 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {group.connectionName}
                  </div>
                  {group.models.map((model, idx) => (
                    <button
                      key={`${model.connectionId}-${model.id}-${idx}`}
                      onClick={() => {
                        onSelect(model.connectionId, model.id);
                        setIsOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                        "hover:bg-zinc-800",
                        model.id === modelId &&
                          model.connectionId === connectionId &&
                          "bg-zinc-800 font-medium text-zinc-100"
                      )}
                    >
                      <span className="truncate text-zinc-300">
                        {model.id}
                      </span>
                      {model.ownedBy && (
                        <span className="ml-2 shrink-0 text-[10px] text-zinc-400">
                          {model.ownedBy}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
