"use client";

import { useState, useEffect, useCallback } from "react";
import type { Conversation } from "@/types";
import {
  getActiveConversationId,
  setActiveConversationId,
} from "@/lib/storage";
import {
  getConversations,
  createConversation,
  deleteConversation as deleteConv,
  migrateFromLocalStorage,
} from "@/lib/conversation-store";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ConversationSidebar } from "@/components/sidebar/ConversationSidebar";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await migrateFromLocalStorage();
      const convs = await getConversations();
      setConversations(convs);
      setActiveId(getActiveConversationId());
      setReady(true);
    })();
  }, []);

  const refreshConversations = useCallback(async () => {
    const convs = await getConversations();
    setConversations(convs);
  }, []);

  const handleNew = useCallback(async () => {
    const conv = await createConversation();
    setActiveConversationId(conv.id);
    setActiveId(conv.id);
    await refreshConversations();
  }, [refreshConversations]);

  const handleSelect = useCallback((id: string) => {
    setActiveConversationId(id);
    setActiveId(id);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteConv(id);
      const remaining = await getConversations();
      setConversations(remaining);
      if (id === activeId) {
        const next = remaining.length > 0 ? remaining[0].id : null;
        setActiveConversationId(next);
        setActiveId(next);
      }
    },
    [activeId]
  );

  if (!ready) return null;

  return (
    <div className="flex h-screen bg-zinc-950">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={handleDelete}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {activeId ? (
            <ChatWindow
              key={activeId}
              conversationId={activeId}
              onConversationUpdate={refreshConversations}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-zinc-700 to-zinc-800 shadow-lg shadow-zinc-900/50">
                  <span className="text-2xl font-black text-zinc-200">B</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-200">
                  Boardroom AI
                </h2>
                <p className="mt-2 text-sm text-zinc-500">
                  Votre comité d&apos;experts IA, prêt à analyser.
                </p>
                <button
                  onClick={handleNew}
                  className="mt-6 rounded-xl bg-zinc-100 px-6 py-2.5 text-sm font-semibold text-zinc-900 transition-all hover:bg-white hover:shadow-lg hover:shadow-zinc-100/10"
                >
                  Nouvelle conversation
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
