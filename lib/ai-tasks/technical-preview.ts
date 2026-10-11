import { buildClassifyTechnicalPrompt } from "@/lib/patterns/prompt";
import { buildSummaryTechnicalPrompt } from "@/lib/agent/summary";
import { buildClassifierTechnical } from "@/lib/calls/classifier-prompt";
import { buildAnalysisTechnical, DEFAULT_RUBRIC, EMPTY_CATEGORIES } from "@/lib/calls/rubric";
import { buildSummaryTechnical } from "@/lib/calls/summary";
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
    // La misma parte fija que el Resumen (es la misma llamada): la lista de
    // etiquetas permitidas, los valores de temperatura y el formato. Los
    // criterios editables van despues, con este encabezado.
    case "close_classification":
      return `${buildSummaryTechnicalPrompt("a1b2c3", ["Interesado", "Precio"], true)}\n\nCriterios del negocio para la clasificacion:\n(lo que escribas arriba)`;
    // Llamadas: la parte fija de cada tarea, con la rubrica generica y los tipos
    // de sistema de muestra (la real depende de la configuracion del negocio).
    case "call_classification":
      return buildClassifierTechnical({ customTypes: [], allowAiTypes: true, discardedTypes: [] });
    case "call_analysis":
      return buildAnalysisTechnical(DEFAULT_RUBRIC, "cierre", { categories: EMPTY_CATEGORIES, allowNewCategories: true, companyContext: null });
    case "call_summary":
      return buildSummaryTechnical({ withMemory: true });
    default:
      return "";
  }
}
