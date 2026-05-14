"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { Sparkles } from "lucide-react";
import type { ChatMessage, EmployeeMemo, EmployeeConfig, ProposedEmployee } from "@/types";
import {
  getConversation,
  updateConversation,
  addEmployeeToConversation,
  updateConversationTitle,
} from "@/lib/conversation-store";
import {
  getConnections,
  getManager,
  getModelsCache,
} from "@/lib/storage";
import { sendChatMessage } from "@/lib/chat-client";
import { ChatBubble } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import { MarkdownContent } from "./MarkdownContent";
import { TeamProposal } from "./TeamProposal";

const SUGGESTIONS = [
  { icon: "📊", label: "Analyse SWOT", prompt: "Fais une analyse SWOT complète de mon business plan pour une startup SaaS B2B." },
  { icon: "⚖️", label: "Comparatif tech", prompt: "Compare les frameworks React, Vue et Svelte pour un projet e-commerce." },
  { icon: "🔒", label: "Audit sécurité", prompt: "Fais un audit de sécurité complet de mon API REST avec recommandations." },
  { icon: "🧠", label: "Stratégie IA", prompt: "Propose une stratégie d'intégration de l'IA dans notre processus de support client." },
];

interface ChatWindowProps {
  conversationId: string;
  onConversationUpdate: () => void;
}

export function ChatWindow({
  conversationId,
  onConversationUpdate,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeEmployees, setActiveEmployees] = useState<EmployeeConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [receivedMemos, setReceivedMemos] = useState<EmployeeMemo[]>([]);
  const [statusText, setStatusText] = useState("");
  const [loadingPhase, setLoadingPhase] = useState<"employees" | "manager" | null>(null);
  const [pendingProposal, setPendingProposal] = useState<ProposedEmployee[] | null>(null);
  const [proposalPrompt, setProposalPrompt] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setIsHydrated(false);

    (async () => {
      const conv = await getConversation(conversationId);
      if (cancelled) return;
      setMessages(conv?.messages ?? []);
      setActiveEmployees((conv?.employees ?? []).filter((e) => e.isActive));
      setPendingProposal(null);
      setProposalPrompt("");
      setStreamingContent("");
      setOverrides({});
      setReceivedMemos([]);
      setLoadingPhase(null);
      setIsLoading(false);
      setIsHydrated(true);
    })();

    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, pendingProposal]);

  const persistMessages = useCallback(
    async (msgs: ChatMessage[]) => {
      await updateConversation(conversationId, { messages: msgs });
    },
    [conversationId]
  );

  const refreshActiveEmployees = useCallback(async () => {
    const conv = await getConversation(conversationId);
    setActiveEmployees((conv?.employees ?? []).filter((e) => e.isActive));
  }, [conversationId]);

  const executeChat = useCallback(
    async (content: string, currentMessages: ChatMessage[], currentOverrides?: Record<string, string>) => {
      const conv = await getConversation(conversationId);
      if (!conv) return;

      const employees = conv.employees;
      const manager = getManager();
      const connections = getConnections();

      let fullContent = "";
      let memos: EmployeeMemo[] = [];

      const historyForApi = currentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await sendChatMessage(historyForApi, employees, manager, connections, {
        onMemos: (m) => {
          memos = m;
          setReceivedMemos(m);
          setLoadingPhase("manager");
          setStatusText("Le Manager rédige sa synthèse...");
        },
        onContent: (chunk) => {
          fullContent += chunk;
          setStreamingContent(fullContent);
        },
        onError: (error) => {
          fullContent += `\n\n[Erreur de streaming : ${error}]`;
          setStreamingContent(fullContent);
        },
        onDone: () => {
          const assistantMsg: ChatMessage = {
            id: uuidv4(),
            role: "assistant",
            content: fullContent,
            timestamp: Date.now(),
            employeeMemos: memos,
          };

          setMessages((prev) => {
            const updated = [...prev, assistantMsg];
            persistMessages(updated);
            return updated;
          });

          setStreamingContent("");
          setReceivedMemos([]);
          setIsLoading(false);
          setStatusText("");
          setLoadingPhase(null);
        },
      }, currentOverrides);
    },
    [conversationId, persistMessages]
  );

  const requestTeamProposal = useCallback(
    async (prompt: string) => {
      const manager = getManager();
      const connections = getConnections();

      if (!manager.connectionId || !manager.modelId) {
        return "Le Manager n'est pas configuré. Allez dans les paramètres pour sélectionner un modèle pour le Manager.";
      }

      setStatusText("Le Manager compose une équipe...");
      setLoadingPhase("employees");

      try {
        const res = await fetch("/api/team-proposal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, manager, connections }),
        });

        const data = await res.json();

        if (!res.ok) {
          return data.error || "Erreur lors de la proposition d'équipe.";
        }

        setPendingProposal(data.team);
        setProposalPrompt(prompt);
        setIsLoading(false);
        setStatusText("");
        setLoadingPhase(null);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Erreur inconnue";
      }
    },
    []
  );

  const handleSend = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content,
        timestamp: Date.now(),
      };

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      persistMessages(updatedMessages);

      if (messages.length === 0) {
        await updateConversationTitle(conversationId, content);
        onConversationUpdate();
      }

      setIsLoading(true);
      setStreamingContent("");
      setReceivedMemos([]);

      const conv = await getConversation(conversationId);
      const emps = (conv?.employees ?? []).filter((e) => e.isActive);

      if (emps.length === 0) {
        setLoadingPhase("employees");
        const errorOrNull = await requestTeamProposal(content);
        if (errorOrNull) {
          const errorMsg: ChatMessage = {
            id: uuidv4(),
            role: "assistant",
            content: errorOrNull,
            timestamp: Date.now(),
          };
          const withError = [...updatedMessages, errorMsg];
          setMessages(withError);
          persistMessages(withError);
          setIsLoading(false);
          setStatusText("");
          setLoadingPhase(null);
        }
        return;
      }

      setLoadingPhase("employees");
      setStatusText("L'équipe analyse la demande...");

      const currentOverrides = { ...overrides };
      setOverrides({});

      try {
        await executeChat(content, updatedMessages, currentOverrides);
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `Erreur : ${err instanceof Error ? err.message : "Erreur inconnue"}`,
          timestamp: Date.now(),
        };
        const withError = [...updatedMessages, errorMsg];
        setMessages(withError);
        persistMessages(withError);
        setIsLoading(false);
        setStreamingContent("");
        setStatusText("");
        setLoadingPhase(null);
      }
    },
    [messages, conversationId, overrides, persistMessages, executeChat, requestTeamProposal, onConversationUpdate]
  );

  const handleTeamValidate = useCallback(
    async (
      accepted: ProposedEmployee[],
      connectionId: string,
      modelId: string
    ) => {
      for (const emp of accepted) {
        await addEmployeeToConversation(conversationId, {
          name: emp.name,
          icon: emp.icon,
          connectionId,
          modelId,
          rolePrompt: emp.systemPrompt,
          isActive: true,
          weight: emp.weight,
        });
      }

      setPendingProposal(null);
      await refreshActiveEmployees();

      const teamMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: `Équipe constituée : ${accepted.map((e) => `**${e.icon} ${e.name}**`).join(", ")}. Lancement de l'analyse...`,
        timestamp: Date.now(),
      };

      const updatedMessages = [...messages, teamMsg];
      setMessages(updatedMessages);
      persistMessages(updatedMessages);

      setIsLoading(true);
      setStreamingContent("");
      setLoadingPhase("employees");
      setStatusText("L'équipe analyse la demande...");

      try {
        await executeChat(proposalPrompt, updatedMessages);
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: `Erreur : ${err instanceof Error ? err.message : "Erreur inconnue"}`,
          timestamp: Date.now(),
        };
        const withError = [...updatedMessages, errorMsg];
        setMessages(withError);
        persistMessages(withError);
        setIsLoading(false);
        setStreamingContent("");
        setStatusText("");
        setLoadingPhase(null);
      }
    },
    [messages, conversationId, proposalPrompt, persistMessages, executeChat, refreshActiveEmployees]
  );

  const handleTeamCancel = () => {
    setPendingProposal(null);
    setProposalPrompt("");
  };

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Hydration loader */}
          {!isHydrated ? (
            <div className="flex h-full min-h-[50vh] items-center justify-center">
              <LoadingDots label="Chargement..." />
            </div>

          /* Empty state with suggestions */
          ) : messages.length === 0 && !isLoading && !pendingProposal ? (
            <div className="flex h-full min-h-[50vh] flex-col items-center justify-center animate-message">
              <div className="text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/80 ring-1 ring-zinc-700/50">
                  <span className="text-xl font-black text-zinc-300">B</span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
                  Bienvenue dans le Boardroom
                </h2>
                <p className="mt-2 text-sm text-zinc-500">
                  Posez une question. Le Manager constituera une équipe d&apos;experts adaptée.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleSend(s.prompt)}
                    className="group flex items-start gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-4 py-3.5 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/60"
                  >
                    <span className="mt-0.5 text-base">{s.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100">{s.label}</p>
                      <p className="mt-0.5 text-xs text-zinc-600 line-clamp-2">{s.prompt}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Messages */}
          {messages.map((msg, idx) => {
            const isLastAssistant =
              msg.role === "assistant" &&
              msg.employeeMemos &&
              msg.employeeMemos.length > 0 &&
              idx === messages.length - 1;

            return (
              <ChatBubble
                key={msg.id}
                message={msg}
                overrides={isLastAssistant ? overrides : undefined}
                onOverrideChange={
                  isLastAssistant
                    ? (empId, instr) =>
                        setOverrides((prev) => ({ ...prev, [empId]: instr }))
                    : undefined
                }
              />
            );
          })}

          {/* Team proposal */}
          {pendingProposal && (
            <div className="animate-message">
              <TeamProposal
                proposals={pendingProposal}
                models={getModelsCache()}
                onValidate={handleTeamValidate}
                onCancel={handleTeamCancel}
              />
            </div>
          )}

          {/* Loading / streaming status */}
          {isLoading && (
            <div className="animate-message">
              <div className="flex gap-3">
                <div className="mt-0.5 shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
                    <span className="text-xs font-black text-zinc-300">B</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-200">Manager</span>
                  </div>

                  {streamingContent ? (
                    <div className="text-sm leading-relaxed text-zinc-300">
                      <MarkdownContent content={streamingContent} />
                      <span className="inline-block text-zinc-500 animate-pulse">▌</span>
                    </div>
                  ) : (
                    <StatusBar
                      phase={loadingPhase}
                      statusText={statusText}
                      activeEmployees={activeEmployees}
                      receivedMemos={receivedMemos}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ChatInput
        onSend={handleSend}
        disabled={!isHydrated || isLoading || !!pendingProposal}
        activeEmployees={activeEmployees}
      />
    </div>
  );
}

function LoadingDots({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-500">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:300ms]" />
      </div>
      <span>{label}</span>
    </div>
  );
}

function StatusBar({
  phase,
  statusText,
  activeEmployees,
  receivedMemos,
}: {
  phase: "employees" | "manager" | null;
  statusText: string;
  activeEmployees: EmployeeConfig[];
  receivedMemos: EmployeeMemo[];
}) {
  const memoDoneIds = new Set(receivedMemos.map((m) => m.employeeId));

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-4">
      {/* Step indicators */}
      <div className="flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <StepDot active={phase === "employees"} done={phase === "manager"} />
          <span className={phase === "employees" ? "text-zinc-200 font-medium" : phase === "manager" ? "text-zinc-500" : "text-zinc-600"}>
            Analyse des experts
          </span>
        </div>
        <div className="h-px flex-1 bg-zinc-800" />
        <div className="flex items-center gap-2">
          <StepDot active={phase === "manager"} done={false} />
          <span className={phase === "manager" ? "text-zinc-200 font-medium" : "text-zinc-600"}>
            Synthèse Manager
          </span>
        </div>
      </div>

      {/* Employee chips with completion state */}
      {activeEmployees.length > 0 && phase === "employees" && (
        <div className="flex flex-wrap gap-1.5">
          {activeEmployees.map((emp) => {
            const done = memoDoneIds.has(emp.id);
            return (
              <span
                key={emp.id}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                  done
                    ? "bg-emerald-950/40 text-emerald-400 ring-1 ring-emerald-900/50"
                    : "bg-zinc-800/80 text-zinc-500 ring-1 ring-zinc-700/40"
                }`}
              >
                <span>{emp.icon}</span>
                <span>{emp.name}</span>
                {!done && <span className="ml-0.5 inline-block h-1 w-1 animate-pulse rounded-full bg-zinc-500" />}
              </span>
            );
          })}
        </div>
      )}

      {/* Status text */}
      {statusText && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          <span>{statusText}</span>
        </div>
      )}
    </div>
  );
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  if (done) {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-900/50 text-emerald-400">
        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (active) {
    return (
      <div className="relative flex h-4 w-4 items-center justify-center">
        <div className="absolute h-4 w-4 animate-ping rounded-full bg-zinc-500/20" />
        <div className="h-2 w-2 rounded-full bg-zinc-300" />
      </div>
    );
  }
  return <div className="h-2 w-2 rounded-full bg-zinc-700" />;
}
