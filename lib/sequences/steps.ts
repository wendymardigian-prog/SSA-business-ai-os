import type { SequenceStep } from "@/lib/types/database";

/**
 * Las cuentas del procesador de secuencias, sin base de datos.
 *
 * Estan aparte para poder testear el cronograma y los reintentos sin montar un
 * cliente falso: son las decisiones que mas facil se rompen sin que nadie se
 * entere hasta que un lead recibe el mensaje equivocado.
 */

/** Cuantas veces se reintenta un paso antes de saltearlo y seguir. */
export const MAX_STEP_ATTEMPTS = 3;

/** Espera entre reintentos, por numero de intento ya consumido. */
const BACKOFF_MINUTES = [5, 15, 45];

export function parseSteps(raw: unknown): SequenceStep[] {
  return Array.isArray(raw) ? (raw as SequenceStep[]) : [];
}

/**
 * Cuando le toca el proximo paso.
 *
 * Un paso de espera define cuanto se espera; despues de uno que manda, el
 * siguiente se ejecuta en el tick siguiente del cron. Devuelve null cuando ya
 * no queda nada por hacer.
 */
export function computeNextStepAt(
  steps: SequenceStep[],
  nextIndex: number,
  now: Date = new Date()
): string | null {
  if (nextIndex >= steps.length) return null;

  const step = steps[nextIndex];
  if (step.type === "delay" && step.delayMinutes && step.delayMinutes > 0) {
    return new Date(now.getTime() + step.delayMinutes * 60_000).toISOString();
  }
  return now.toISOString();
}

/** Cuando se vuelve a intentar el paso que acaba de fallar. */
export function nextAttemptAt(attemptsUsed: number, now: Date = new Date()): string {
  const minutes =
    BACKOFF_MINUTES[Math.min(attemptsUsed, BACKOFF_MINUTES.length) - 1] ??
    BACKOFF_MINUTES[0];
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Se agotaron los intentos de este paso? */
export function attemptsExhausted(attemptsUsed: number): boolean {
  return attemptsUsed >= MAX_STEP_ATTEMPTS;
}

/**
 * Las variables que puede usar el texto de un paso.
 *
 * Mismo formato que en los flows ({{contact.display_name}}), asi que quien ya
 * armo un flow no tiene que aprender otra cosa.
 *
 * `first_name` no es una columna: sale de la primera palabra del nombre. Es lo
 * que un mensaje realmente quiere ("Hola Ana", no "Hola Ana Perez"), y un
 * nombre de una sola palabra devuelve esa palabra.
 */
export function stepVariables(contact: {
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  instagram_username?: string | null;
}): Record<string, unknown> {
  const displayName = contact.display_name?.trim() ?? "";
  return {
    contact: {
      display_name: displayName,
      first_name: displayName.split(/\s+/)[0] ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      instagram_username: contact.instagram_username ?? "",
    },
  };
}
