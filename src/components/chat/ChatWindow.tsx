"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";
import { Sparkles, RefreshCw, Settings, AlertTriangle } from "lucide-react";
import { formatApiError } from "@/lib/utils";
import type { ChatMessage, EmployeeMemo, EmployeeConfig, ProposedEmployee, TokenUsage } from "@/types";
import {
  getConversation,
  updateConversation,
  addEmployeeToConversation,
  updateConversationTitle,
  clearEmployeesFromConversation,
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
  onOpenSettings: () => void;
  configVersion?: number;
}

const INTERRUPTED_MSG = "[Génération interrompue par l'utilisateur]";

export function ChatWindow({
  conversationId,
  onConversationUpdate,
  onOpenSettings,
  configVersion = 0,
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
  const [isRescoping, setIsRescoping] = useState(false);
  const [rescopeSubject, setRescopeSubject] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef("");

  const isConfigured = useMemo(
    () => getConnections().length > 0 && !!getManager().modelId,
    [configVersion, isHydrated]
  );

  const displayEmployees = useMemo(() => {
    const validConnectionIds = new Set(getConnections().map((c) => c.id));
    return activeEmployees.filter(
      (e) => e.isActive && validConnectionIds.has(e.connectionId)
    );
  }, [activeEmployees, configVersion]);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);

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

  const finalizeInterrupted = useCallback(
    (partialContent: string) => {
      const content = partialContent.trim()
        ? `${partialContent}\n\n${INTERRUPTED_MSG}`
        : INTERRUPTED_MSG;

      setMessages((prev) => {
        const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content,
          timestamp: Date.now(),
        };
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
    [persistMessages]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    finalizeInterrupted(streamingContentRef.current);
    setStreamingContent("");
  }, [finalizeInterrupted]);

  const executeChat = useCallback(
    async (
      content: string,
      currentMessages: ChatMessage[],
      currentOverrides?: Record<string, string>,
      fastMode?: boolean,
      signal?: AbortSignal
    ) => {
      const conv = await getConversation(conversationId);
      if (!conv) return;

      const employees = conv.employees;
      const manager = getManager();
      const connections = getConnections();

      let fullContent = "";
      let memos: EmployeeMemo[] = [];
      let tokenUsage: TokenUsage | undefined;

      const historyForApi = currentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await sendChatMessage(historyForApi, employees, manager, connections, {
        onMemos: (m) => {
          memos = m;
          setReceivedMemos(m);
          setLoadingPhase("manager");
          setStatusText(fastMode ? "Le Manager répond..." : "Le Manager rédige sa synthèse...");
        },
        onContent: (chunk) => {
          fullContent += chunk;
          setStreamingContent(fullContent);
        },
        onError: (error) => {
          fullContent += `\n\n[Erreur de streaming : ${formatApiError(error)}]`;
          setStreamingContent(fullContent);
        },
        onDone: (usage) => {
          tokenUsage = usage;
          const assistantMsg: ChatMessage = {
            id: uuidv4(),
            role: "assistant",
            content: fullContent,
            timestamp: Date.now(),
            employeeMemos: memos.length > 0 ? memos : undefined,
            tokenUsage,
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
      }, currentOverrides, fastMode, signal);
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
      if (!isConfigured) return;

      const isFastMode = content.trim().startsWith("/fast ");

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

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

      if (isFastMode) {
        setLoadingPhase("manager");
        setStatusText("Le Manager répond en direct...");

        try {
          await executeChat(content, updatedMessages, undefined, true, signal);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          const errorMsg: ChatMessage = {
            id: uuidv4(),
            role: "assistant",
            content: formatApiError(err),
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
        return;
      }

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
        await executeChat(content, updatedMessages, currentOverrides, false, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const errorMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: formatApiError(err),
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
    [messages, conversationId, overrides, persistMessages, executeChat, requestTeamProposal, onConversationUpdate, isConfigured]
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

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setIsLoading(true);
      setStreamingContent("");
      setLoadingPhase("employees");
      setStatusText("L'équipe analyse la demande...");

      try {
        await executeChat(proposalPrompt, updatedMessages, undefined, false, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const errorMsg: ChatMessage = {
          id: uuidv4(),
          role: "assistant",
          content: formatApiError(err),
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

  const handleRescopeTeam = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    setRescopeSubject(lastUserMsg?.content?.slice(0, 100) ?? "");
    setIsRescoping(true);
  }, [messages]);

  const handleRescopeCancel = useCallback(() => {
    setIsRescoping(false);
    setRescopeSubject("");
  }, []);

  const handleRescopeSubmit = useCallback(async () => {
    const subject = rescopeSubject.trim();
    if (!subject) return;

    setIsRescoping(false);
    setRescopeSubject("");

    await clearEmployeesFromConversation(conversationId);
    setActiveEmployees([]);

    setIsLoading(true);
    setStreamingContent("");
    setReceivedMemos([]);
    setLoadingPhase("employees");

    const errorOrNull = await requestTeamProposal(subject);
    if (errorOrNull) {
      const errorMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: errorOrNull,
        timestamp: Date.now(),
      };
      setMessages((prev) => {
        const updated = [...prev, errorMsg];
        persistMessages(updated);
        return updated;
      });
      setIsLoading(false);
      setStatusText("");
      setLoadingPhase(null);
    }
  }, [rescopeSubject, conversationId, persistMessages, requestTeamProposal]);

  const handleRetry = useCallback(async () => {
    if (messages.length < 2 || isLoading) return;

    const lastAssistantIdx = messages.length - 1;
    if (messages[lastAssistantIdx].role !== "assistant") return;

    const withoutLast = messages.slice(0, lastAssistantIdx);
    setMessages(withoutLast);
    await persistMessages(withoutLast);

    const lastUserMsg = [...withoutLast].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    setIsLoading(true);
    setStreamingContent("");
    setReceivedMemos([]);
    setLoadingPhase("employees");
    setStatusText("L'équipe analyse la demande...");

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      await executeChat(lastUserMsg.content, withoutLast, undefined, false, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const errorMsg: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: formatApiError(err),
        timestamp: Date.now(),
      };
      const withError = [...withoutLast, errorMsg];
      setMessages(withError);
      persistMessages(withError);
      setIsLoading(false);
      setStreamingContent("");
      setStatusText("");
      setLoadingPhase(null);
    }
  }, [messages, isLoading, persistMessages, executeChat]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Top bar with re-scope button */}
      {activeEmployees.length > 0 && !isLoading && !pendingProposal && (
        <div className="flex items-center justify-end border-b border-zinc-800/40 px-4 py-2">
          <button
            onClick={handleRescopeTeam}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-300"
            title="Reformer l'équipe"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reformer l&apos;équipe
          </button>
        </div>
      )}

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

              {isConfigured ? (
                <div className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      className="group flex items-start gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-4 py-3.5 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/60"
                    >
                      <span className="mt-0.5 text-base">{s.icon}</span>
                      <div>
                        <p className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100">{s.label}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600">{s.prompt}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-8 w-full max-w-md space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3.5 text-left">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                    <div>
                      <p className="text-sm font-medium text-amber-200">Configuration requise</p>
                      <p className="mt-1 text-xs text-amber-200/70">
                        Ajoutez une connexion API et sélectionnez un modèle pour le Manager avant de commencer.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onOpenSettings}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-6 py-3 text-sm font-semibold text-zinc-900 transition-all hover:bg-white"
                  >
                    <Settings className="h-4 w-4" />
                    Configurer le Boardroom
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {/* Messages */}
          {messages.map((msg, idx) => {
            const isLast = idx === messages.length - 1;
            const isLastAssistant =
              msg.role === "assistant" &&
              msg.employeeMemos &&
              msg.employeeMemos.length > 0 &&
              isLast;

            return (
              <ChatBubble
                key={msg.id}
                message={msg}
                isLast={isLast}
                onRetry={isLast && msg.role === "assistant" && !isLoading ? handleRetry : undefined}
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
                    <div className="space-y-2">
                      <div className="text-sm leading-relaxed text-zinc-300">
                        <MarkdownContent content={streamingContent} />
                        <span className="inline-block text-zinc-500 animate-pulse">▌</span>
                      </div>
                      <StopButton onStop={handleStop} />
                    </div>
                  ) : (
                    <StatusBar
                      phase={loadingPhase}
                      statusText={statusText}
                      activeEmployees={activeEmployees}
                      receivedMemos={receivedMemos}
                      onStop={handleStop}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {isRescoping && (
        <div className="border-t border-zinc-800/40 bg-zinc-900/50 px-4 py-3">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <input
              type="text"
              value={rescopeSubject}
              onChange={(e) => setRescopeSubject(e.target.value)}
              placeholder="Nouveau sujet de la conversation ?"
              className="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              onKeyDown={(e) => e.key === "Enter" && handleRescopeSubmit()}
            />
            <button
              onClick={handleRescopeSubmit}
              disabled={!rescopeSubject.trim()}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
            >
              Valider
            </button>
            <button
              onClick={handleRescopeCancel}
              className="rounded-lg px-4 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        disabled={!isHydrated || !isConfigured || isLoading || !!pendingProposal || isRescoping}
        placeholder={
          !isConfigured
            ? "Veuillez configurer l'application d'abord"
            : "Posez votre question au Boardroom..."
        }
        activeEmployees={isLoading ? [] : displayEmployees}
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

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      onClick={onStop}
      className="rounded-md px-2.5 py-1 text-xs font-medium text-red-400/90 transition-colors hover:bg-red-950/40 hover:text-red-300"
    >
      🛑 Arrêter
    </button>
  );
}

function StatusBar({
  phase,
  statusText,
  activeEmployees,
  receivedMemos,
  onStop,
}: {
  phase: "employees" | "manager" | null;
  statusText: string;
  activeEmployees: EmployeeConfig[];
  receivedMemos: EmployeeMemo[];
  onStop?: () => void;
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

      {/* Status text + stop */}
      <div className="flex items-center justify-between gap-3">
        {statusText ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span>{statusText}</span>
          </div>
        ) : (
          <div />
        )}
        {onStop && <StopButton onStop={onStop} />}
      </div>
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
