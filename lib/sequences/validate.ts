import type { SequenceStep } from "@/lib/types/database";

/**
 * Validacion de secuencias, del lado del servidor.
 *
 * Hoy la unica validacion vive en el editor: el boton de activar chequea que
 * haya un paso de mensaje, y nada mas. Cualquiera que llame la Server Action
 * directamente puede guardar un paso con el texto vacio, y el procesador manda
 * un DM en blanco. El repo no usa zod: la convencion es una funcion pura por
 * modulo, testeable y reusable desde el cliente.
 */

export const MAX_SEQUENCE_NAME = 80;
export const MAX_STEP_CONTENT = 2000;
export const MAX_STEP_PROMPT = 2000;
export const MAX_STEPS = 50;
/** Un año. Mas que eso es casi seguro un error de unidad. */
export const MAX_DELAY_MINUTES = 525_600;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateSequenceName(raw: string): Validated<string> {
  const name = (raw ?? "").trim();
  if (!name) return { ok: false, error: "Poné un nombre para la secuencia" };
  if (name.length > MAX_SEQUENCE_NAME) {
    return {
      ok: false,
      error: `El nombre es muy largo (máximo ${MAX_SEQUENCE_NAME} caracteres)`,
    };
  }
  return { ok: true, value: name };
}

/**
 * Normaliza y valida los pasos.
 *
 * Devuelve los pasos limpios (sin campos de otro tipo de paso colgando) para
 * que lo que se guarda en el jsonb sea exactamente lo que el procesador espera.
 */
export function validateSequenceSteps(raw: unknown): Validated<SequenceStep[]> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Los pasos de la secuencia llegaron en un formato que no entiendo" };
  }
  if (raw.length > MAX_STEPS) {
    return { ok: false, error: `Una secuencia puede tener hasta ${MAX_STEPS} pasos` };
  }

  const steps: SequenceStep[] = [];

  for (let i = 0; i < raw.length; i++) {
    const step = raw[i] as Partial<SequenceStep> | null;
    const position = i + 1;

    if (!step || typeof step !== "object") {
      return { ok: false, error: `El paso ${position} está vacío` };
    }

    if (step.type === "message") {
      const content = (step.content ?? "").trim();
      if (!content) {
        return { ok: false, error: `Escribí el mensaje del paso ${position}` };
      }
      if (content.length > MAX_STEP_CONTENT) {
        return {
          ok: false,
          error: `El mensaje del paso ${position} es muy largo (máximo ${MAX_STEP_CONTENT} caracteres)`,
        };
      }
      steps.push({ type: "message", content });
      continue;
    }

    if (step.type === "delay") {
      const minutes = Number(step.delayMinutes);
      if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < 1) {
        return { ok: false, error: `La espera del paso ${position} tiene que ser de al menos 1 minuto` };
      }
      if (minutes > MAX_DELAY_MINUTES) {
        return { ok: false, error: `La espera del paso ${position} es demasiado larga (máximo un año)` };
      }
      steps.push({ type: "delay", delayMinutes: minutes });
      continue;
    }

    if (step.type === "aiMessage") {
      const prompt = (step.prompt ?? "").trim();
      if (!prompt) {
        return {
          ok: false,
          error: `Escribí qué tiene que decir la IA en el paso ${position}`,
        };
      }
      if (prompt.length > MAX_STEP_PROMPT) {
        return {
          ok: false,
          error: `La consigna del paso ${position} es muy larga (máximo ${MAX_STEP_PROMPT} caracteres)`,
        };
      }
      const clean: SequenceStep = { type: "aiMessage", prompt };
      if (step.provider) clean.provider = String(step.provider);
      if (step.model) clean.model = String(step.model);
      if (step.contextMessages !== undefined) {
        const n = Number(step.contextMessages);
        if (!Number.isInteger(n) || n < 0 || n > 50) {
          return {
            ok: false,
            error: `El contexto del paso ${position} tiene que ser un número entre 0 y 50`,
          };
        }
        clean.contextMessages = n;
      }
      steps.push(clean);
      continue;
    }

    return { ok: false, error: `El paso ${position} tiene un tipo que no conozco` };
  }

  return { ok: true, value: steps };
}

/**
 * Puede activarse esta secuencia?
 *
 * Sin un paso que mande algo, activar no hace nada: los contactos se
 * inscribirian para recorrer una lista de esperas y salir por el otro lado.
 */
export function canActivate(steps: SequenceStep[]): Validated<true> {
  if (steps.length === 0) {
    return { ok: false, error: "Agregá al menos un paso antes de activar la secuencia" };
  }
  const sends = steps.some((s) => s.type === "message" || s.type === "aiMessage");
  if (!sends) {
    return {
      ok: false,
      error: "La secuencia solo tiene esperas. Agregá un mensaje antes de activarla.",
    };
  }
  return { ok: true, value: true };
}
