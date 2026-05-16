"use client";

import { useState } from "react";
import { Check, X, Users, Sparkles, ChevronDown, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProposedEmployee, FetchedModel } from "@/types";
import { ModelSelector } from "@/components/settings/ModelSelector";

function WeightSelector({
  weight,
  onChange,
}: {
  weight: 1 | 2 | 3;
  onChange: (w: 1 | 2 | 3) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex gap-0.5">
        {([1, 2, 3] as const).map((w) => (
          <button
            key={w}
            onClick={() => onChange(w)}
            className="p-0.5 transition-all"
          >
            <Star
              className={cn(
                "h-4 w-4 transition-all",
                w <= weight
                  ? weight === 3
                    ? "fill-amber-400 text-amber-400"
                    : weight === 2
                      ? "fill-blue-400 text-blue-400"
                      : "fill-zinc-400 text-zinc-400"
                  : "text-zinc-700 hover:text-zinc-400"
              )}
            />
          </button>
        ))}
      </div>
      <span className={cn(
        "text-[11px] font-medium",
        weight === 3 ? "text-amber-400" : weight === 2 ? "text-blue-400" : "text-zinc-400"
      )}>
        {weight === 3 ? "Critique" : weight === 2 ? "Important" : "Consultatif"}
      </span>
    </div>
  );
}

interface TeamProposalProps {
  proposals: ProposedEmployee[];
  models: FetchedModel[];
  onValidate: (
    accepted: ProposedEmployee[],
    connectionId: string,
    modelId: string
  ) => void;
  onCancel: () => void;
}

export function TeamProposal({
  proposals: initial,
  models,
  onValidate,
  onCancel,
}: TeamProposalProps) {
  const [proposals, setProposals] = useState<ProposedEmployee[]>(initial);
  const [connectionId, setConnectionId] = useState("");
  const [modelId, setModelId] = useState("");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const acceptedCount = proposals.filter((p) => p.accepted).length;
  const canValidate = acceptedCount >= 1 && connectionId && modelId;

  const toggleAccepted = (index: number) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === index ? { ...p, accepted: !p.accepted } : p))
    );
  };

  const updateName = (index: number, name: string) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === index ? { ...p, name } : p))
    );
  };

  const updatePrompt = (index: number, systemPrompt: string) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === index ? { ...p, systemPrompt } : p))
    );
  };

  const updateWeight = (index: number, weight: 1 | 2 | 3) => {
    setProposals((prev) =>
      prev.map((p, i) => (i === index ? { ...p, weight } : p))
    );
  };

  const handleValidate = () => {
    if (!canValidate) return;
    onValidate(
      proposals.filter((p) => p.accepted),
      connectionId,
      modelId
    );
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/20">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-800/30 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-zinc-200 to-zinc-400">
            <Sparkles className="h-4 w-4 text-zinc-900" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Équipe proposée par l&apos;assistant
            </h3>
            <p className="text-xs text-zinc-400">
              Validez, modifiez ou retirez des experts avant de lancer l&apos;analyse.
            </p>
          </div>
        </div>

        {/* Model selector */}
        <div className="border-b border-zinc-800 px-5 py-4">
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Modèle utilisé par les employés
          </p>
          <ModelSelector
            models={models}
            connectionId={connectionId}
            modelId={modelId}
            onSelect={(cId, mId) => {
              setConnectionId(cId);
              setModelId(mId);
            }}
          />
        </div>

        {/* Employee cards */}
        <div className="divide-y divide-zinc-800/50">
          {proposals.map((proposal, index) => {
            const isExpanded = expandedIndex === index;

            return (
              <div
                key={index}
                className={cn(
                  "px-5 py-4 transition-all duration-200",
                  !proposal.accepted && "opacity-30 scale-[0.98]"
                )}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggleAccepted(index)}
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all duration-200",
                      proposal.accepted
                        ? "border-emerald-500/50 bg-emerald-500 text-white scale-100"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 scale-95"
                    )}
                  >
                    {proposal.accepted ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <span className="mt-0.5 text-xl">{proposal.icon}</span>

                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={proposal.name}
                      onChange={(e) => updateName(index, e.target.value)}
                      className="w-full border-none bg-transparent text-sm font-semibold text-zinc-100 outline-none placeholder:text-zinc-400"
                    />
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                      {proposal.justification}
                    </p>

                    <WeightSelector
                      weight={proposal.weight}
                      onChange={(w) => updateWeight(index, w)}
                    />

                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="mt-2 flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-400"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      System prompt
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="ml-16 mt-2 animate-message">
                    <textarea
                      value={proposal.systemPrompt}
                      onChange={(e) => updatePrompt(index, e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs leading-relaxed text-zinc-400
                        outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-800/30 px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Users className="h-3.5 w-3.5" />
            <span className="tabular-nums">
              <span className="text-zinc-200 font-semibold">{acceptedCount}</span>
              {" "}expert{acceptedCount > 1 ? "s" : ""} sélectionné{acceptedCount > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              Annuler
            </button>
            <button
              onClick={handleValidate}
              disabled={!canValidate}
              className="flex items-center gap-2 rounded-lg bg-zinc-100 px-5 py-2 text-xs font-semibold text-zinc-900 transition-all
                hover:bg-white disabled:opacity-30 disabled:hover:bg-zinc-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Lancer l&apos;équipe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
