import { z } from "zod";
import type { AgentToolDefinition } from "./types";

/**
 * declarar_intencion (F26): el agente declara en cada turno qué intención tiene
 * el mensaje del lead, elegida entre las categorías inbound activas. No tiene
 * efecto en el CRM; se guarda en agent_runs.intent y alimenta la condición
 * "Intención" de las reglas. Si el category_id no existe, se guarda null.
 */
const inputSchema = z.object({
  category_id: z.string().describe("El id de una de las categorías de intención ofrecidas."),
  confidence: z.number().min(0).max(1).describe("Qué tan seguro estás, de 0 a 1."),
});

export const declareIntentTool: AgentToolDefinition<z.infer<typeof inputSchema>, Record<string, never>> = {
  name: "declarar_intencion",
  label: "Declarar la intención del mensaje",
  description:
    "Antes de responder, declará la intención del último mensaje del lead eligiendo una de las categorías ofrecidas. No le avises al lead. Es para medir y para las reglas.",
  inputSchema,
  configSchema: z.object({}),
  configFields: [],
  // Opt-in desde la pestaña Herramientas (no `required`, para no forzarla en
  // todos los agentes ni cambiar el set por defecto). Cuando está activa, el
  // agente declara la intención y se guarda en agent_runs.intent (F26).
  capturesIntent: true,
  async execute() {
    // Sin efecto: la captura la hace buildToolSet en state.intent.
    return { ok: true, forModel: "Intención registrada.", stepAlreadyRecorded: false };
  },
};

/** Valida la intención capturada contra las categorías inbound activas (F26). */
export function validateIntent(
  raw: { category_id?: string; confidence?: number } | null | undefined,
  validCategoryIds: Set<string>,
): { category_id: string | null; confidence: number } | null {
  if (!raw || typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) return null;
  if (!raw.category_id || !validCategoryIds.has(raw.category_id)) {
    // Categoría inexistente: se guarda null (el turno sigue).
    return null;
  }
  return { category_id: raw.category_id, confidence: raw.confidence };
}
