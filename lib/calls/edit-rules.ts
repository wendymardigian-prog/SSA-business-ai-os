/**
 * Constantes de las acciones de edicion de llamadas. Viven fuera del archivo
 * "use server" (ahi solo se pueden exportar funciones asincronicas) para que la
 * pantalla las importe sin pasar por el servidor.
 */

/** Los motivos para regenerar un analisis. El de contexto lleva un texto obligatorio. */
export const REGENERATE_REASONS = ["prompt_nuevo", "transcripcion_incompleta", "analisis_con_errores", "falta_contexto"] as const;
export type RegenerateReason = (typeof REGENERATE_REASONS)[number];

export const REGENERATE_REASON_LABELS: Record<RegenerateReason, string> = {
  prompt_nuevo: "Cambié las instrucciones o la rúbrica",
  transcripcion_incompleta: "La transcripción estaba incompleta",
  analisis_con_errores: "El análisis tenía errores",
  falta_contexto: "Faltaba contexto",
};

export const REGENERATE_CONTEXT_MIN = 3;
export const REGENERATE_CONTEXT_MAX = 2000;

/** "Analizar pendientes": cuantas se encolan y cada cuanto (para no pegarle de golpe al proveedor). */
export const ANALYZE_PENDING_LIMIT = 20;
export const ANALYZE_PENDING_SPACING_MS = 30_000;

/** Lo que dice una objecion del closer. */
export const OBJECTION_NOTE_MAX = 1000;
export const OBJECTIONS_MAX = 50;

export type SectionOrigin = "manual" | "ai_correction";
