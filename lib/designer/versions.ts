/**
 * Versiones de un diseño o una plantilla (F27): cuándo se guarda una y cómo se ve en la lista.
 *
 * Una versión (`design_versions`, solo el documento, nunca imágenes) se guarda:
 *   - en cada respuesta de la IA (lo hace DS3), al publicar (DS5), al generar desde una plantilla (DS6) y al cargar un
 *     HTML (DS4);
 *   - al crear (el documento de arranque) y al restaurar una versión;
 *   - y, en la EDICIÓN MANUAL, **como máximo una cada 10 minutos**: el primer guardado después de una pausa de 10 minutos
 *     deja una versión con el documento que se guardó.
 * Restaurar crea una versión NUEVA: nunca se borra una versión (solo la limpieza diaria, a los 30 días).
 *
 * Guardar una versión NO encola ningún render: las miniaturas son en vivo (F48).
 *
 * Módulo puro.
 */

export const MANUAL_VERSION_GAP_MS = 10 * 60 * 1000;

export type VersionReason = "ai" | "manual" | "publish" | "restore" | "generate" | "import";

/** Si un guardado manual deja una versión: no hubo ninguna versión manual en los últimos 10 minutos. */
export function shouldSnapshotManual(lastManualAt: string | Date | null | undefined, now: Date): boolean {
  if (!lastManualAt) return true;
  const last = typeof lastManualAt === "string" ? Date.parse(lastManualAt) : lastManualAt.getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= MANUAL_VERSION_GAP_MS;
}

export const REASON_LABELS: Record<VersionReason, string> = {
  ai: "Pedido a la IA",
  manual: "Edición",
  publish: "Publicado",
  restore: "Restaurada",
  generate: "Generada",
  import: "Archivo cargado",
};

/** Quién la hizo: la persona o «IA». */
export function versionAuthor(version: { authorKind: "user" | "ai"; authorName: string | null }): string {
  if (version.authorKind === "ai") return "IA";
  return version.authorName?.trim() || "Alguien del equipo";
}

/** La fecha de una versión en la zona de quien mira: «hoy 09:12», «ayer 18:20», «5 oct». */
export function versionWhen(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = (date: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const get = (type: string) => p.find((x) => x.type === type)?.value ?? "00";
    return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
  };
  const a = parts(at);
  const n = parts(now);
  const days = (p: { y: number; m: number; d: number }) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000);
  const diff = days(n) - days(a);
  if (diff === 0) return `hoy ${a.hh}:${a.mm}`;
  if (diff === 1) return `ayer ${a.hh}:${a.mm}`;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
  return `${a.d} ${months[a.m - 1]}${a.y !== n.y ? ` ${a.y}` : ""} ${a.hh}:${a.mm}`;
}
