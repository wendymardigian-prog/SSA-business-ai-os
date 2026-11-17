// @plantilla-quitar(servicios)
/**
 * Cómo se ve, en el editor del programa, el estado de la transcripción de una clase (puro). La transcripción vive en
 * Conocimiento (`knowledge_base.program_item_id`); solo la usa el tutor, el estudiante no la ve.
 */
export interface TranscriptInfo {
  status: string;
  chunks: number | null;
  at: string | null;
}

export type TranscriptBadge = { tone: "ok" | "warn" | "missing"; label: string; detail: string };

const day = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : null);

export function transcriptBadge(t: TranscriptInfo | null | undefined): TranscriptBadge {
  if (!t) return { tone: "missing", label: "Falta", detail: "Todavía no tiene transcripción: el tutor no usa esta clase." };
  if (t.status === "ready") {
    const parts = t.chunks ? `${t.chunks} ${t.chunks === 1 ? "parte" : "partes"}` : null;
    const when = day(t.at);
    return { tone: "ok", label: "Cargada", detail: ["Lista para el tutor", parts, when ? `actualizada el ${when}` : null].filter(Boolean).join(" · ") };
  }
  return { tone: "warn", label: "Sin indexar", detail: "Está guardada pero el tutor todavía no la puede usar (falta conectar Voyage o falló). Se reintenta desde Conocimiento." };
}
