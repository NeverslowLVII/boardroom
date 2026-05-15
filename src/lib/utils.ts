import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatApiError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Erreur inconnue";

  const lower = message.toLowerCase();

  if (
    lower.includes("401") ||
    lower.includes("authentication") ||
    lower.includes("missing authentication") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key")
  ) {
    return "Clé API invalide ou manquante. Veuillez vérifier vos paramètres de connexion.";
  }

  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return "Quota API dépassé ou trop de requêtes simultanées.";
  }

  if (
    lower.includes("504") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("deadline")
  ) {
    return "Le modèle a mis trop de temps à répondre.";
  }

  return message;
}
