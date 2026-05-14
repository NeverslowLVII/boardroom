import localforage from "localforage";
import { v4 as uuidv4 } from "uuid";
import type { Conversation, ChatMessage, EmployeeConfig } from "@/types";

const store = localforage.createInstance({
  name: "boardroom",
  storeName: "conversations",
});

const INDEX_KEY = "__conversation_index";

interface ConversationIndex {
  id: string;
  title: string;
  createdAt: number;
}

async function getIndex(): Promise<ConversationIndex[]> {
  return (await store.getItem<ConversationIndex[]>(INDEX_KEY)) ?? [];
}

async function saveIndex(index: ConversationIndex[]): Promise<void> {
  await store.setItem(INDEX_KEY, index);
}

function convKey(id: string): string {
  return `conv_${id}`;
}

// --- Public API ---

export async function getConversations(): Promise<Conversation[]> {
  const index = await getIndex();
  const convs = await Promise.all(
    index.map(async (entry) => {
      const conv = await store.getItem<Conversation>(convKey(entry.id));
      if (conv) return conv;
      return {
        id: entry.id,
        title: entry.title,
        messages: [],
        employees: [],
        createdAt: entry.createdAt,
      } satisfies Conversation;
    })
  );
  return convs;
}

export async function getConversationList(): Promise<ConversationIndex[]> {
  return getIndex();
}

export async function createConversation(): Promise<Conversation> {
  const conv: Conversation = {
    id: uuidv4(),
    title: "Nouvelle conversation",
    messages: [],
    employees: [],
    createdAt: Date.now(),
  };

  await store.setItem(convKey(conv.id), conv);

  const index = await getIndex();
  index.unshift({ id: conv.id, title: conv.title, createdAt: conv.createdAt });
  await saveIndex(index);

  return conv;
}

export async function getConversation(
  id: string
): Promise<Conversation | undefined> {
  const conv = await store.getItem<Conversation>(convKey(id));
  return conv ?? undefined;
}

export async function updateConversation(
  id: string,
  updates: Partial<Omit<Conversation, "id">>
): Promise<void> {
  const conv = await store.getItem<Conversation>(convKey(id));
  if (!conv) return;

  const updated = { ...conv, ...updates };
  await store.setItem(convKey(id), updated);

  if (updates.title) {
    const index = await getIndex();
    const entry = index.find((e) => e.id === id);
    if (entry) {
      entry.title = updates.title;
      await saveIndex(index);
    }
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await store.removeItem(convKey(id));
  const index = await getIndex();
  await saveIndex(index.filter((e) => e.id !== id));
}

// --- Conversation helpers ---

export async function addMessageToConversation(
  convId: string,
  message: ChatMessage
): Promise<void> {
  const conv = await getConversation(convId);
  if (!conv) return;
  await updateConversation(convId, { messages: [...conv.messages, message] });
}

export async function addEmployeeToConversation(
  convId: string,
  employee: Omit<EmployeeConfig, "id">
): Promise<EmployeeConfig> {
  const conv = await getConversation(convId);
  if (!conv) throw new Error("Conversation not found");
  const newEmp: EmployeeConfig = { ...employee, id: uuidv4() };
  await updateConversation(convId, {
    employees: [...conv.employees, newEmp],
  });
  return newEmp;
}

export async function clearEmployeesFromConversation(
  convId: string
): Promise<void> {
  await updateConversation(convId, { employees: [] });
}

export async function updateConversationTitle(
  convId: string,
  firstMessage: string
): Promise<void> {
  const title =
    firstMessage.length > 50
      ? firstMessage.slice(0, 50) + "..."
      : firstMessage;
  await updateConversation(convId, { title });
}

// --- Migration from LocalStorage ---

export async function migrateFromLocalStorage(): Promise<boolean> {
  const LEGACY_KEY = "boardroom_conversations";
  if (typeof window === "undefined") return false;

  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return false;

    const legacyConvs: Conversation[] = JSON.parse(raw);
    if (!Array.isArray(legacyConvs) || legacyConvs.length === 0) return false;

    const existingIndex = await getIndex();
    if (existingIndex.length > 0) {
      localStorage.removeItem(LEGACY_KEY);
      return false;
    }

    for (const conv of legacyConvs) {
      await store.setItem(convKey(conv.id), conv);
    }

    await saveIndex(
      legacyConvs.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
      }))
    );

    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    return false;
  }
}
