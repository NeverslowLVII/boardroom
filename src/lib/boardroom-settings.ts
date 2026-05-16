"use client";

import {
  isBoardroomConfigReady,
  isLikelyLocalLlmEndpoint,
} from "@/lib/boardroom-config";
import {
  getConnections,
  getManager,
  getModelsCache,
  saveModelsCache,
} from "@/lib/storage";
import type { ApiConnection, FetchedModel, ManagerConfig } from "@/types";

export interface BoardroomSettings {
  manager: ManagerConfig;
  connections: ApiConnection[];
}

/** Charge la config partagée chat / eval depuis le localStorage. */
export function loadBoardroomSettings(): BoardroomSettings {
  return {
    manager: getManager(),
    connections: getConnections(),
  };
}

export function isSettingsReady(settings: BoardroomSettings): boolean {
  return isBoardroomConfigReady(settings.manager, settings.connections);
}

export function getManagerConnection(
  settings: BoardroomSettings
): ApiConnection | undefined {
  return settings.connections.find(
    (c) => c.id === settings.manager.connectionId
  );
}

export function expertsRunInParallel(settings: BoardroomSettings): boolean {
  const conn = getManagerConnection(settings);
  return conn ? isLikelyLocalLlmEndpoint(conn.baseUrl) : false;
}

export async function fetchBoardroomModels(
  connections: ApiConnection[]
): Promise<{
  models: FetchedModel[];
  errors: { connectionId: string; error: string }[];
}> {
  const valid = connections.filter((c) => c.baseUrl?.trim() && c.apiKey);
  if (valid.length === 0) {
    return { models: [], errors: [] };
  }

  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connections: valid }),
  });

  const data = (await res.json()) as {
    models?: FetchedModel[];
    errors?: { connectionId: string; error: string }[];
  };

  if (!res.ok) {
    return { models: [], errors: [] };
  }

  const models = data.models ?? [];
  saveModelsCache(models);
  return { models, errors: data.errors ?? [] };
}

export async function testManagerConnection(
  settings: BoardroomSettings
): Promise<{ ok: boolean; message: string }> {
  const conn = getManagerConnection(settings);
  if (!conn?.baseUrl?.trim()) {
    return { ok: false, message: "Connexion du manager non configurée." };
  }

  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connections: [conn] }),
  });

  const data = (await res.json()) as {
    models?: FetchedModel[];
    errors?: { connectionId: string; error: string }[];
  };

  const err = data.errors?.[0]?.error;
  const count = (data.models ?? []).filter(
    (m) => m.connectionId === conn.id
  ).length;

  if (res.ok && !err) {
    return {
      ok: true,
      message: `Connexion OK (${count} modèle(s) pour « ${conn.name} »).`,
    };
  }
  return { ok: false, message: err ?? "Échec du test de connexion." };
}

export function loadModelsCache(): FetchedModel[] {
  return getModelsCache();
}
