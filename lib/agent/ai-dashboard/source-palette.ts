import { RUN_SOURCE_LABELS } from "@/lib/agent/run-labels";

/**
 * Color por `source` de `agent_runs`, para el grafico de barras apiladas
 * (A4).
 *
 * Ocho colores fijos, en el orden que valida la guia de dataviz (nunca se
 * reordenan: el orden es parte de lo que la hace segura para quien no
 * distingue bien los colores). Mas de ocho series en un grafico es ruido, asi
 * que los origenes de sistema —indexar la base, el resumen de cierre, y
 * `message_classification_eval`, que esta en el CHECK y nadie lo escribe
 * (docs/PENDIENTE.md)— y cualquier valor futuro que no este en esta lista
 * caen en "Otros", que usa el gris de `--c-ext` en vez de un noveno color.
 */
export const OTROS_KEY = "otros";
export const OTROS_LABEL = "Otros (sistema)";
export const OTROS_COLOR = "var(--src-otros)";

export const SOURCE_COLORS: Record<string, string> = {
  agent: "var(--src-agent)",
  flow_ai_node: "var(--src-flow)",
  sequence_ai_step: "var(--src-sequence)",
  message_classification: "var(--src-classifier)",
  content_copy: "var(--src-copywriter)",
  ads_analysis: "var(--src-ads)",
  audio_transcription: "var(--src-transcription)",
  media_description: "var(--src-media)",
};

/** El orden fijo de la leyenda y del apilado: las 8 propias, despues Otros. */
export const SOURCE_ORDER: string[] = [...Object.keys(SOURCE_COLORS), OTROS_KEY];

/** A que serie de la leyenda pertenece un `source` real. */
export function seriesKeyFor(source: string): string {
  return source in SOURCE_COLORS ? source : OTROS_KEY;
}

export function seriesColor(key: string): string {
  return SOURCE_COLORS[key] ?? OTROS_COLOR;
}

export function seriesLabel(key: string): string {
  if (key === OTROS_KEY) return OTROS_LABEL;
  return RUN_SOURCE_LABELS[key] ?? key;
}
