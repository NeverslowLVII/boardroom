"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Copy, Check, RotateCcw, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";
import { EmployeeMemoPanel } from "./EmployeeMemoPanel";
import { MarkdownContent } from "./MarkdownContent";

interface ChatBubbleProps {
  message: ChatMessage;
  overrides?: Record<string, string>;
  onOverrideChange?: (employeeId: string, instruction: string) => void;
  onRetry?: () => void;
  isLast?: boolean;
}

const COLLAPSE_THRESHOLD_PX = 400;

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "maintenant";
  if (mins < 60) return `il y a ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatTokenCount(n: number): string {
  return n.toLocaleString("fr-FR");
}

function DownloadMessageButton({ content, timestamp }: { content: string; timestamp: number }) {
  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boardroom-decision-${timestamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      title="Télécharger la décision"
    >
      <Download className="h-3.5 w-3.5" />
      Exporter
    </button>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      title="Copier"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

function CollapsibleContent({ children, defaultCollapsed = false }: { children: React.ReactNode; defaultCollapsed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (ref.current && ref.current.scrollHeight > COLLAPSE_THRESHOLD_PX) {
      setIsLong(true);
      if (defaultCollapsed) setExpanded(false);
    }
  }, [defaultCollapsed]);

  return (
    <div>
      <div
        ref={ref}
        className="overflow-hidden transition-[max-height] duration-300"
        style={{ maxHeight: !isLong || expanded ? "none" : `${COLLAPSE_THRESHOLD_PX}px` }}
      >
        {children}
      </div>
      {isLong && !expanded && (
        <div className="pointer-events-none relative -mt-12 h-12 bg-gradient-to-t from-zinc-950 to-transparent" />
      )}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expanded ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </div>
  );
}

export function ChatBubble({ message, overrides, onOverrideChange, onRetry, isLast }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("group/bubble animate-message", isUser && "flex justify-end")}>
      <div className={cn("flex max-w-[85%] gap-3", isUser && "flex-row-reverse")}>
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
        <div className={cn("min-w-0 flex-1", isUser && "flex flex-col items-end")}>
          {/* Label + timestamp */}
          <div className={cn("mb-1 flex items-center gap-2", isUser && "flex-row-reverse")}>
            <span className="text-sm font-semibold text-zinc-200">
              {isUser ? "CEO" : "Manager"}
            </span>
            <span className="text-xs text-zinc-600">
              {timeAgo(message.timestamp)}
            </span>
          </div>

          {/* Message body */}
          {isUser ? (
            <div className="rounded-xl bg-zinc-800 px-4 py-3 text-right text-sm leading-relaxed text-zinc-100">
              <CollapsibleContent defaultCollapsed>
                <div className="whitespace-pre-wrap text-right">{message.content}</div>
              </CollapsibleContent>
            </div>
          ) : (
            <div className="relative w-full">
              <CollapsibleContent>
                <div className="text-sm leading-relaxed text-zinc-300">
                  <MarkdownContent content={message.content} />
                </div>
              </CollapsibleContent>
              {message.tokenUsage && (
                <span className="mt-1 block text-right text-[10px] text-zinc-600">
                  ⚡ {formatTokenCount(message.tokenUsage.totalTokens)} tokens
                </span>
              )}
            </div>
          )}

          {/* Action bar: copy + export + retry */}
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/bubble:opacity-100",
              isUser && "justify-end"
            )}
          >
            <CopyMessageButton text={message.content} />
            {!isUser && (
              <DownloadMessageButton content={message.content} timestamp={message.timestamp} />
            )}
            {!isUser && isLast && onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                title="Relancer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Relancer
              </button>
            )}
          </div>

          {/* Employee memos */}
          {!isUser && message.employeeMemos && message.employeeMemos.length > 0 && (
            <div className="mt-3 w-full">
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
