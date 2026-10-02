/**
 * La franja de primera conexion (G8).
 *
 * Un workspace nuevo abre Integraciones con catorce cards grises y nada que
 * diga por donde empezar. La franja aparece mientras falte al menos uno de
 * tres minimos, y muestra solo los que faltan.
 */

import { PROVIDERS, isTextProvider } from "./providers";
import type { IntegrationStatus } from "./status";

export interface MissingEssential {
  key: "messaging" | "ai_text" | "email";
  label: string;
  /** Que conviene conectar para resolverlo. */
  suggestion: string;
}

/** "Ya se empezo" = tiene algun estado conocido y no es `not_connected`. */
function hasAny(ids: string[], statusOf: (id: string) => IntegrationStatus | undefined): boolean {
  return ids.some((id) => {
    const status = statusOf(id);
    return status !== undefined && status !== "not_connected";
  });
}

/** Los tres minimos que faltan, en el orden en que se muestran. Vacio = los tres estan. */
export function missingEssentials(
  statusOf: (providerId: string) => IntegrationStatus | undefined,
): MissingEssential[] {
  const missing: MissingEssential[] = [];

  if (!hasAny(["zernio", "evolution"], statusOf)) {
    missing.push({
      key: "messaging",
      label: "Un canal de mensajeria",
      suggestion: "Zernio (Instagram) o Evolution (WhatsApp)",
    });
  }

  const textProviderIds = PROVIDERS.filter(isTextProvider).map((p) => p.id);
  if (!hasAny(textProviderIds, statusOf)) {
    missing.push({ key: "ai_text", label: "Un proveedor de IA de texto", suggestion: "Anthropic" });
  }

  if (!hasAny(["resend"], statusOf)) {
    missing.push({ key: "email", label: "Email saliente", suggestion: "Resend" });
  }

  return missing;
}

/** Cada cuantos dias vuelve a aparecer la franja descartada, si sigue faltando algo. */
export const ONBOARDING_DISMISS_DAYS = 7;

/** Si corresponde mostrar la franja, dado cuando se descarto por ultima vez. */
export function shouldShowBanner(dismissedAt: string | null, now: Date = new Date()): boolean {
  if (!dismissedAt) return true;
  const at = new Date(dismissedAt).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= ONBOARDING_DISMISS_DAYS * 24 * 60 * 60 * 1000;
}
