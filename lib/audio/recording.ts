/**
 * La lógica pura de grabar y mandar un audio (F18, F19).
 *
 * El componente (`components/inbox/voice-recorder.tsx`) solo usa esto: elegir
 * el mime, calcular la extensión, formatear el contador, traducir los errores
 * del micrófono, y decidir si Instagram va a aceptar el archivo. Nada de esto
 * toca el DOM ni el `MediaRecorder`: se prueba sin un navegador de verdad.
 *
 * Modulo PURO.
 */

/** Los mimes que se prueban, EN ESTE ORDEN. audio/mp4 primero a proposito: es el unico que Instagram acepta (§10.1 del plano). */
export const RECORDING_MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"] as const;

/**
 * El primer mime que el navegador sabe grabar, en el orden de preferencia.
 *
 * `isTypeSupported` se inyecta para no depender de `MediaRecorder` global en
 * los tests (no existe en Node); en el navegador por defecto usa el real.
 */
export function pickRecordingMime(
  isTypeSupported: (mime: string) => boolean = (mime) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime),
): string | null {
  for (const mime of RECORDING_MIME_CANDIDATES) {
    if (isTypeSupported(mime)) return mime;
  }
  return null;
}

/** La extension del archivo que se sube, a partir del mime con el que grabo el navegador. */
export function extensionForRecordingMime(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  if (clean === "audio/mp4") return "m4a";
  if (clean === "audio/webm") return "webm";
  return "m4a";
}

/** Cuanto puede durar una grabacion antes del corte automatico. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * El contador que se muestra mientras se graba: `m:ss`.
 *
 * La duracion sale del contador del cliente y no del archivo (F18): el webm
 * que graba Chrome no trae la duracion en la cabecera, y el reproductor
 * mostraria `Infinity`.
 */
export function formatRecordingDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** El motivo del micrófono, en castellano y sin jerga del navegador. */
export function microphoneErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : null;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Habilitá el micrófono para este sitio";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No encontramos ningún micrófono conectado";
    case "NotReadableError":
    case "TrackStartError":
      return "Otra aplicación está usando el micrófono";
    default:
      return "No pudimos acceder al micrófono";
  }
}

/**
 * Si Instagram va a aceptar este audio (F19, §10.1).
 *
 * Verificado: acepta AAC, M4A, WAV y MP4; rechaza ogg/opus y mp3. Por
 * WhatsApp no importa: Evolution convierte cualquier formato con su propio
 * ffmpeg (encoding:true).
 */
const INSTAGRAM_REJECTED_AUDIO_MIME = new Set(["audio/ogg", "audio/opus", "audio/webm", "audio/mpeg", "audio/mp3"]);

export function instagramAcceptsAudio(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const clean = mime.split(";")[0].trim().toLowerCase();
  return !INSTAGRAM_REJECTED_AUDIO_MIME.has(clean);
}

export const INSTAGRAM_AUDIO_REJECTED_MESSAGE =
  "Instagram no acepta este formato de audio. Probá desde Safari o mandalo por WhatsApp.";
