/**
 * La selección múltiple de Grabaciones: cuáles hay que clasificar antes de analizar y el aviso del resultado. PURO
 * (lo usa la barra de selección; las reglas de verdad las vuelve a mirar el servidor).
 */
import { ANALYZE_PENDING_LIMIT } from "./edit-rules";

/** El tope de «Analizar con IA» en grupo: el mismo de «Analizar seleccionadas» (`ANALYZE_PENDING_LIMIT`). */
export const BULK_ANALYZE_LIMIT = ANALYZE_PENDING_LIMIT;

/** El tope de «Cambiar tipo» en grupo: una página de la lista. */
export const BULK_TYPE_LIMIT = 30;

export interface BulkCandidate {
  callId: string;
  /** Sin tipo, o con el tipo «por revisar»: hay que elegirlo antes de analizar. */
  needsType: boolean;
}

/**
 * Lo que se manda a analizar: las primeras 20 de la selección (en el orden de la lista) y, de esas, las que hay que
 * clasificar antes (sin tipo o con el tipo por revisar). `overLimit`: cuántas quedaron fuera por el tope.
 */
export function planBulkAnalyze<T extends BulkCandidate>(selected: readonly T[]): { toAnalyze: T[]; needType: T[]; overLimit: number } {
  const toAnalyze = selected.slice(0, BULK_ANALYZE_LIMIT);
  return { toAnalyze, needType: toAnalyze.filter((c) => c.needsType), overLimit: selected.length - toAnalyze.length };
}

export type BulkSkipReason = "analyzed" | "busy" | "no_show" | "no_transcript" | "no_type" | "no_profile" | "not_found" | "queued_already";

const SKIP_TEXT: Record<BulkSkipReason, [string, string]> = {
  analyzed: ["ya estaba analizada", "ya estaban analizadas"],
  busy: ["se está procesando", "se están procesando"],
  no_show: ["es un no-show", "son no-show"],
  no_transcript: ["no tiene transcripción", "no tienen transcripción"],
  no_type: ["no tiene tipo", "no tienen tipo"],
  no_profile: ["no tiene analizador para su tipo", "no tienen analizador para su tipo"],
  not_found: ["no se encontró", "no se encontraron"],
  queued_already: ["ya estaba en la cola", "ya estaban en la cola"],
};

/** «Se analizarán 5 grabaciones (una cada 30 segundos). 2 ya estaban analizadas; 1 no tiene transcripción.» */
export function bulkAnalyzeSummary(res: { queued: number; skipped: Partial<Record<BulkSkipReason, number>>; typeErrors: number }, overLimit = 0): string {
  const head = res.queued === 0 ? "No se encoló ninguna para analizar." : res.queued === 1 ? "Se analizará 1 grabación." : `Se analizarán ${res.queued} grabaciones (una cada 30 segundos).`;
  const parts = (Object.entries(res.skipped) as Array<[BulkSkipReason, number]>)
    .filter(([, n]) => n > 0)
    .map(([why, n]) => `${n} ${SKIP_TEXT[why][n === 1 ? 0 : 1]}`);
  if (res.typeErrors > 0) parts.push(res.typeErrors === 1 ? "1 no pudo guardar el tipo" : `${res.typeErrors} no pudieron guardar el tipo`);
  if (overLimit > 0) parts.push(`${overLimit} quedaron fuera por el tope de ${BULK_ANALYZE_LIMIT}`);
  return parts.length ? `${head} ${parts.join("; ")}.` : head;
}
