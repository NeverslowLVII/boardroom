"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { getConversation } from "@/lib/conversation-store";
import {
  copyConversationExport,
  downloadConversationExport,
} from "@/lib/export-conversation";
import type { ChatMessage } from "@/types";

interface ExportConversationButtonProps {
  conversationId: string;
  /** Messages affichés (inclut les mémos employés non visibles dans la synthèse seule). */
  liveMessages: ChatMessage[];
}

export function ExportConversationButton({
  conversationId,
  liveMessages,
}: ExportConversationButtonProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadConversation = async () => {
    const stored = await getConversation(conversationId);
    if (!stored) {
      throw new Error("Conversation introuvable.");
    }
    const messages = liveMessages.length > 0 ? liveMessages : stored.messages;
    if (messages.length === 0) {
      throw new Error("Aucun message à exporter.");
    }
    return { ...stored, messages };
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const conv = await loadConversation();
      downloadConversationExport(conv);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const conv = await loadConversation();
      await copyConversationExport(conv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
        title="JSON : fil complet, équipe, mémos de chaque expert et synthèses Manager"
      >
        <Download className="h-3.5 w-3.5" />
        Exporter tout
      </button>
      <button
        type="button"
        onClick={handleCopy}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
        title="Copier le JSON complet (conversation + employés)"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}
