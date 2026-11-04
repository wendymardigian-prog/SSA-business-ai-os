/** Lo que devuelven las vistas previas de un broadcast (en un archivo aparte: un "use server" solo exporta funciones). */
import type { AudienceSkipReason, ReachSummary } from "./audience";

export interface AudiencePreview {
  reach: ReachSummary;
  /** Motivo → texto, para la pantalla. */
  skippedLabels: { reason: AudienceSkipReason; label: string; count: number }[];
  sample: { contactId: string; name: string; detail: string; ok: boolean }[];
  truncated: boolean;
}

export interface MessagePreview {
  samples: { name: string; subject: string | null; text: string; missing: string[] }[];
  /** De la muestra revisada, a cuántos les falta algún dato sin respaldo. */
  missingCount: number;
  checked: number;
}
