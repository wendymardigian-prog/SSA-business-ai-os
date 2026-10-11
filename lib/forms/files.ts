/**
 * Qué archivos de una respuesta se pueden pedir (F13). Puro.
 *
 * Un link firmado se genera SOLO para un archivo que pertenece a esa respuesta:
 * una ruta cualquiera mandada a mano no sirve, aunque la persona vea la respuesta.
 */

export interface StoredFile {
  path: string;
  name: string;
  size: number;
  mime: string;
}

/** Todos los archivos guardados en las respuestas de una submission. */
export function filesOfAnswers(answers: Record<string, { value?: unknown }> | null | undefined): StoredFile[] {
  const out: StoredFile[] = [];
  for (const answer of Object.values(answers ?? {})) {
    if (!Array.isArray(answer?.value)) continue;
    for (const item of answer.value) {
      if (item && typeof item === "object" && typeof (item as StoredFile).path === "string" && typeof (item as StoredFile).name === "string") {
        out.push(item as StoredFile);
      }
    }
  }
  return out;
}

/** ¿Esta ruta es un archivo de esta respuesta (y está dentro de su carpeta)? */
export function isFileOfSubmission(
  answers: Record<string, { value?: unknown }> | null | undefined,
  uploadPrefix: string | null | undefined,
  path: string,
): boolean {
  if (!uploadPrefix || !path.startsWith(`${uploadPrefix}/`) || path.includes("..")) return false;
  return filesOfAnswers(answers).some((f) => f.path === path);
}

export const SIGNED_URL_SECONDS = 60;
