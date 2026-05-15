"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Trash2,
  UserCog,
  Cable,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ApiConnection,
  ManagerConfig,
  FetchedModel,
} from "@/types";
import {
  getConnections,
  saveConnections,
  addConnection,
  deleteConnection,
  getManager,
  saveManager,
  getModelsCache,
  saveModelsCache,
} from "@/lib/storage";
import { ModelSelector } from "./ModelSelector";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = "connections" | "manager";

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("connections");
  const [connections, setConnectionsState] = useState<ApiConnection[]>([]);
  const [manager, setManagerState] = useState<ManagerConfig>(getManager());
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchErrors, setFetchErrors] = useState<
    { connectionId: string; error: string }[]
  >([]);

  useEffect(() => {
    if (isOpen) {
      setConnectionsState(getConnections());
      setManagerState(getManager());
      setModels(getModelsCache());
    }
  }, [isOpen]);

  const fetchAllModels = useCallback(async () => {
    const conns = getConnections();
    const valid = conns.filter((c) => c.baseUrl && c.apiKey);
    if (valid.length === 0) return;

    setIsFetchingModels(true);
    setFetchErrors([]);

    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connections: valid }),
      });

      const data = await res.json();
      if (res.ok) {
        setModels(data.models);
        saveModelsCache(data.models);
        if (data.errors?.length) {
          setFetchErrors(data.errors);
        }
      }
    } catch {
      // silently fail
    } finally {
      setIsFetchingModels(false);
    }
  }, []);

  if (!isOpen) return null;

  const handleAddConnection = () => {
    const conn = addConnection({
      name: `API ${connections.length + 1}`,
      baseUrl: "",
      apiKey: "",
    });
    setConnectionsState((prev) => [...prev, conn]);
  };

  const handleUpdateConnection = (
    id: string,
    field: keyof ApiConnection,
    value: string
  ) => {
    setConnectionsState((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, [field]: value } : c
      );
      saveConnections(updated);
      return updated;
    });
  };

  const handleDeleteConnection = (id: string) => {
    deleteConnection(id);
    setConnectionsState((prev) => prev.filter((c) => c.id !== id));
    setModels((prev) => {
      const filtered = prev.filter((m) => m.connectionId !== id);
      saveModelsCache(filtered);
      return filtered;
    });
  };

  const handleUpdateManager = (field: keyof ManagerConfig, value: string) => {
    setManagerState((prev) => {
      const updated = { ...prev, [field]: value };
      saveManager(updated);
      return updated;
    });
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "connections", label: "Connexions", icon: <Cable className="h-4 w-4" /> },
    { id: "manager", label: "Manager", icon: <UserCog className="h-4 w-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="font-display text-lg font-semibold text-zinc-100">
            Paramètres
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 px-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition-colors",
                tab === t.id
                  ? "border-zinc-100 text-zinc-100"
                  : "border-transparent text-zinc-400 hover:text-zinc-300"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "connections" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-400">
                  Configurez vos fournisseurs d&apos;API (OpenAI-compatible).
                </p>
                <button
                  onClick={fetchAllModels}
                  disabled={isFetchingModels || connections.length === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs
                    font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isFetchingModels && "animate-spin")} />
                  {isFetchingModels ? "Chargement..." : "Récupérer les modèles"}
                </button>
              </div>

              {fetchErrors.length > 0 && (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-400">
                  {fetchErrors.map((e) => {
                    const conn = connections.find((c) => c.id === e.connectionId);
                    return (
                      <div key={e.connectionId}>
                        <span className="font-medium">{conn?.name ?? e.connectionId}</span> : {e.error}
                      </div>
                    );
                  })}
                </div>
              )}

              {models.length > 0 && (
                <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-400">
                  {models.length} modèle{models.length > 1 ? "s" : ""} disponible{models.length > 1 ? "s" : ""}
                </div>
              )}

              {connections.map((conn) => (
                <div key={conn.id} className="rounded-xl border border-zinc-800 bg-zinc-800/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <input
                      type="text"
                      value={conn.name}
                      onChange={(e) => handleUpdateConnection(conn.id, "name", e.target.value)}
                      className="border-none bg-transparent text-[13px] font-medium text-zinc-100 outline-none placeholder:text-zinc-400"
                      placeholder="Nom de la connexion"
                    />
                    <button
                      onClick={() => handleDeleteConnection(conn.id)}
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <SettingsField label="Base URL" value={conn.baseUrl} placeholder="https://api.openai.com/v1" onChange={(v) => handleUpdateConnection(conn.id, "baseUrl", v)} />
                    <SettingsField label="API Key" value={conn.apiKey} placeholder="sk-..." type="password" onChange={(v) => handleUpdateConnection(conn.id, "apiKey", v)} />
                  </div>
                </div>
              ))}

              <button
                onClick={handleAddConnection}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 py-4 text-[13px]
                  text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
                Ajouter une connexion
              </button>
            </div>
          )}

          {tab === "manager" && (
            <div className="space-y-4">
              <ModelSelector
                models={models}
                connectionId={manager.connectionId}
                modelId={manager.modelId}
                onSelect={(connId, modId) => {
                  handleUpdateManager("connectionId", connId);
                  handleUpdateManager("modelId", modId);
                }}
              />

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  System Prompt du Manager
                </label>
                <textarea
                  value={manager.systemPrompt}
                  onChange={(e) => handleUpdateManager("systemPrompt", e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-300
                    outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-300
          outline-none placeholder:text-zinc-400 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700"
      />
    </div>
  );
}
