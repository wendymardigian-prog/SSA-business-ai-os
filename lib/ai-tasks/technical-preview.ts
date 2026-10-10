import { buildClassifyTechnicalPrompt } from "@/lib/patterns/prompt";
import { buildSummaryTechnicalPrompt } from "@/lib/agent/summary";
import type { AiTaskId } from "./catalog";

/**
 * La parte técnica (fija) de cada tarea, con valores de muestra, para
 * mostrarla de referencia en la pestaña Instrucciones (Agentes IA). Nunca se
 * usa para construir un prompt real — eso lo hacen los builders con el
 * nonce y los datos reales de la corrida.
 *
 * Módulo hoja a propósito (lib/ai-tasks/instructions.ts y store.ts no lo
 * importan): `prompt.ts` y `summary.ts` ya importan de `instructions.ts`, así
 * que juntar esto ahí crearía un ciclo.
 */
export function technicalPreviewFor(task: AiTaskId): string {
  switch (task) {
    case "message_classification":
      return buildClassifyTechnicalPrompt({ direction: "inbound", nonce: "a1b2c3" });
    case "conversation_summary":
      return buildSummaryTechnicalPrompt("a1b2c3", ["Interesado", "Precio"], true);
    default:
      return "";
  }
}
