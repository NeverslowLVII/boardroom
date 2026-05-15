"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import type { EmployeeConfig } from "@/types";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  activeEmployees?: EmployeeConfig[];
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled,
  activeEmployees = [],
  placeholder = "Posez votre question au Boardroom...",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [teamExpanded, setTeamExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasText = value.trim().length > 0;
  const showTeamBadge = activeEmployees.length > 0;

  return (
    <div className="px-4 pb-5 pt-2">
      <div className="mx-auto max-w-5xl">
        {/* Collapsible team badge */}
        {showTeamBadge && (
          <div className="mb-2 px-1">
            <button
              onClick={() => setTeamExpanded(!teamExpanded)}
              className="flex items-center gap-1.5 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
            >
              {teamExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span>Équipe ({activeEmployees.length})</span>
            </button>
            {teamExpanded && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {activeEmployees.map((emp) => (
                  <span
                    key={emp.id}
                    className="flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] text-zinc-400 ring-1 ring-zinc-700/40"
                  >
                    <span className="text-xs">{emp.icon}</span>
                    <span>{emp.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm transition-colors focus-within:border-zinc-700 focus-within:bg-zinc-900">
          <div className="flex items-end gap-2 px-4 py-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-zinc-200
                placeholder:text-zinc-600 focus:outline-none disabled:opacity-40"
            />
            <button
              onClick={handleSubmit}
              disabled={disabled || !hasText}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all",
                hasText
                  ? "bg-zinc-100 text-zinc-900 hover:bg-white"
                  : "bg-zinc-800 text-zinc-500"
              )}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          {/* Keyboard hint */}
          <div className="flex items-center justify-end border-t border-zinc-800/50 px-4 py-1.5">
            <span className="text-[11px] text-zinc-600">
              <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500">Enter</kbd> envoyer · <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500">Shift+Enter</kbd> retour ligne
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
