"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, MessageSquarePlus, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmployeeMemo } from "@/types";
import { MarkdownContent } from "./MarkdownContent";

interface EmployeeMemoPanelProps {
  memos: EmployeeMemo[];
  overrides?: Record<string, string>;
  onOverrideChange?: (employeeId: string, instruction: string) => void;
}

export function EmployeeMemoPanel({ memos, overrides = {}, onOverrideChange }: EmployeeMemoPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [challengingId, setChallengingId] = useState<string | null>(null);

  const overrideCount = Object.values(overrides).filter((v) => v.trim()).length;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40">
      {/* Chips bar -- always visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2.5 transition-colors hover:bg-zinc-800/30"
      >
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {memos.map((m) => (
            <span
              key={m.employeeId}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                m.error
                  ? "bg-red-950/40 text-red-400 ring-1 ring-red-900/50"
                  : "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700/50"
              )}
            >
              <span>{m.employeeIcon || "🧑‍💼"}</span>
              <span>{m.employeeName}</span>
            </span>
          ))}
        </div>

        {overrideCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-amber-400">
            <MessageSquarePlus className="h-3 w-3" />
            {overrideCount}
          </span>
        )}
      </button>

      {/* Expanded memo cards */}
      {isOpen && (
        <div className="animate-message space-y-2 border-t border-zinc-800/60 px-3 py-3">
          {memos.map((memo) => {
            const isChallenging = challengingId === memo.employeeId;
            const currentOverride = overrides[memo.employeeId] ?? "";

            return (
              <div
                key={memo.employeeId}
                className={cn(
                  "overflow-hidden rounded-lg ring-1",
                  memo.error
                    ? "ring-red-900/50 bg-red-950/20"
                    : "ring-zinc-800 bg-zinc-900/60"
                )}
              >
                {/* Card header */}
                <div className="flex items-center gap-2.5 border-b border-zinc-800/50 px-3.5 py-2.5">
                  <span className="text-base">{memo.employeeIcon || "🧑‍💼"}</span>
                  <span className="flex-1 text-sm font-semibold text-zinc-200">{memo.employeeName}</span>
                  <span className="flex items-center gap-1 text-xs text-zinc-600">
                    <Clock className="h-3 w-3" />
                    {(memo.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>

                {/* Card body */}
                <div className="px-3.5 py-3 text-sm text-zinc-300">
                  {memo.error ? (
                    <div className="flex items-start gap-2 text-red-400">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{memo.error}</span>
                    </div>
                  ) : (
                    <MarkdownContent content={memo.content ?? ""} />
                  )}
                </div>

                {/* Challenge section */}
                {!memo.error && onOverrideChange && (
                  <div className="border-t border-zinc-800/40 px-3.5 py-2.5">
                    {!isChallenging && !currentOverride && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setChallengingId(memo.employeeId); }}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-amber-400"
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                        Challenger
                      </button>
                    )}

                    {(isChallenging || currentOverride) && (
                      <div className="space-y-1.5">
                        <textarea
                          value={currentOverride}
                          onChange={(e) => onOverrideChange(memo.employeeId, e.target.value)}
                          placeholder="Ex: Corrige ton analyse sur le point X, tu as omis..."
                          rows={2}
                          className="w-full rounded-lg border border-amber-900/40 bg-amber-950/10 px-3 py-2 text-sm text-zinc-300
                            outline-none placeholder:text-zinc-600 focus:border-amber-700 focus:ring-1 focus:ring-amber-700/40"
                        />
                        {currentOverride.trim() ? (
                          <p className="text-xs text-amber-500/70">
                            Sera envoyée au prochain message.
                          </p>
                        ) : isChallenging ? (
                          <button
                            onClick={() => setChallengingId(null)}
                            className="text-xs text-zinc-600 hover:text-zinc-400"
                          >
                            Annuler
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
