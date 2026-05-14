"use client";

import { Plus, Trash2, MessageSquare, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
}

type TemporalGroup = { label: string; conversations: Conversation[] };

function groupByDate(conversations: Conversation[]): TemporalGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const groups: Record<string, Conversation[]> = {
    "Aujourd'hui": [],
    "Hier": [],
    "7 derniers jours": [],
    "Plus ancien": [],
  };

  for (const conv of conversations) {
    const t = conv.createdAt;
    if (t >= todayStart) groups["Aujourd'hui"].push(conv);
    else if (t >= yesterdayStart) groups["Hier"].push(conv);
    else if (t >= weekStart) groups["7 derniers jours"].push(conv);
    else groups["Plus ancien"].push(conv);
  }

  return Object.entries(groups)
    .filter(([, convs]) => convs.length > 0)
    .map(([label, convs]) => ({ label, conversations: convs }));
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onOpenSettings,
}: ConversationSidebarProps) {
  const groups = groupByDate(conversations);

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col bg-zinc-950 border-r border-zinc-800/50">
      {/* Logo + new */}
      <div className="px-3 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-zinc-100 to-zinc-300 text-xs font-black text-zinc-900">
              B
            </div>
            <div>
              <span className="text-sm font-semibold text-zinc-100 tracking-tight">
                Boardroom
              </span>
              <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
                AI
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-2.5 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700/50 transition-all hover:bg-zinc-700 hover:text-white"
        >
          <Plus className="h-4 w-4" />
          Nouvelle conversation
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <MessageSquare className="h-6 w-6 text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-600">
              Aucune conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.conversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => onSelect(conv.id)}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition-all",
                        conv.id === activeId
                          ? "bg-zinc-800/80 text-zinc-100"
                          : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-50" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {conv.title}
                      </span>
                      {conv.employees.length > 0 && (
                        <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-500 ring-1 ring-zinc-700/40">
                          {conv.employees.filter(e => e.isActive).length}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conv.id);
                        }}
                        className="shrink-0 rounded p-1 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom settings */}
      <div className="border-t border-zinc-800/50 px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition-all hover:bg-zinc-800/40 hover:text-zinc-300"
        >
          <Settings className="h-3.5 w-3.5" />
          Paramètres
        </button>
      </div>
    </div>
  );
}
