/**
 * La transcripcion de un anuncio: que se guarda cuando una persona la escribe a mano (00323).
 *
 * Puro, para que la regla sea la misma en la accion y en sus tests, y coincida con el CHECK
 * `meta_ads_transcript_shape`: con texto queda `ready` + `manual`; vacia vuelve a `none` sin texto
 * ni fuente. La transcripcion automatica (mas adelante) va a escribir `auto` y nunca pisar una `manual`.
 *
 * El texto se guarda tal cual lo escribio la persona (saltos de linea incluidos), solo sin los
 * espacios de las puntas y con los saltos normalizados a `\n`.
 */

/** Tope de caracteres: un video de anuncio de 3 minutos son ~3.000; esto deja lugar de sobra para notas. */
export const MAX_TRANSCRIPT_CHARS = 20_000;

export type TranscriptStatus = "none" | "pending" | "ready" | "failed";
export type TranscriptSource = "auto" | "manual";

export interface TranscriptWrite {
  transcript: string | null;
  transcript_status: TranscriptStatus;
  transcript_source: TranscriptSource | null;
}

export type TranscriptInputResult = { ok: true; value: TranscriptWrite } | { ok: false; error: string };

export function manualTranscriptWrite(input: unknown): TranscriptInputResult {
  if (input !== null && input !== undefined && typeof input !== "string") {
    return { ok: false, error: "La transcripción tiene que ser texto." };
  }
  const clean = (input ?? "").replace(/\r\n?/g, "\n").trim();
  if (clean.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, error: `La transcripción es muy larga: el máximo es de ${MAX_TRANSCRIPT_CHARS.toLocaleString("es")} caracteres.` };
  }
  if (clean === "") return { ok: true, value: { transcript: null, transcript_status: "none", transcript_source: null } };
  return { ok: true, value: { transcript: clean, transcript_status: "ready", transcript_source: "manual" } };
}

/** Lo que el detalle del anuncio muestra de su video (00323). */
export interface AdMedia {
  /** Hay un video para pedirle a Meta: un id guardado, un creativo de video o una publicacion de Instagram. */
  videoKind: "video" | "instagram_post" | null;
  transcript: string | null;
  transcriptSource: string | null;
  transcriptUpdatedAt: string | null;
  /** El guion de la pieza de Contenido vinculada, si tiene. Es lo planeado; la transcripcion es lo que se dijo. */
  pieceScript: string | null;
  /** Quien mira puede escribir la transcripcion (`content.create`, como vincular con una pieza). */
  canEditTranscript: boolean;
}
