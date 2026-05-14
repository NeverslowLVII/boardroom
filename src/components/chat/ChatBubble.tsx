"use client";

import type { ChatMessage } from "@/types";
import { EmployeeMemoPanel } from "./EmployeeMemoPanel";
import { MarkdownContent } from "./MarkdownContent";

interface ChatBubbleProps {
  message: ChatMessage;
  overrides?: Record<string, string>;
  onOverrideChange?: (employeeId: string, instruction: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "maintenant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function ChatBubble({ message, overrides, onOverrideChange }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className="animate-message">
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="mt-0.5 shrink-0">
          {isUser ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-800">
              C
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
              <span className="text-xs font-black text-zinc-300">B</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Label + timestamp */}
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-200">
              {isUser ? "CEO" : "Manager"}
            </span>
            <span className="text-xs text-zinc-600">
              {timeAgo(message.timestamp)}
            </span>
          </div>

          {/* Message body */}
          {isUser ? (
            <div className="rounded-xl bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-300">
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ) : (
            <div className="text-sm leading-relaxed text-zinc-300">
              <MarkdownContent content={message.content} />
            </div>
          )}

          {/* Employee memos */}
          {!isUser && message.employeeMemos && message.employeeMemos.length > 0 && (
            <div className="mt-3">
              <EmployeeMemoPanel
                memos={message.employeeMemos}
                overrides={overrides}
                onOverrideChange={onOverrideChange}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
