/**
 * La causa de baja de una reunión. PURO.
 *
 * El negocio define su lista de causas (Agentes IA › Análisis de llamadas, junto a las categorías; vacía al empezar).
 * El analizador de las reuniones de formato general (servicio, seguimiento) la detecta SOLO cuando el cliente habla
 * de irse, cancelar o no renovar, y siempre con una cita textual: sin cita que esté en la transcripción, o con una
 * clave que no está en la lista activa, no hay causa. Sin lista, no se le pregunta nada a la IA (el esquema y el
 * pedido quedan como siempre).
 *
 * Vive en `calls.analysis.causa_baja` (las fichas la buscan ahí, sin columna aparte). Una persona la puede corregir o
 * quitar desde la reunión (gana sobre lo de la IA hasta el próximo análisis).
 */
import { z } from "zod";
import { quoteInTranscript } from "./scoring";
import { slugKey, uniqueKey } from "./rubric";

export interface ChurnReason {
  clave: string;
  nombre: string;
  archivado?: boolean;
}

export const MAX_CHURN_REASONS = 30;
export const CHURN_REASON_NAME_MAX = 80;
export const CHURN_MOTIVE_MAX = 500;
export const CHURN_QUOTE_MAX = 400;

/** La causa como queda guardada en el análisis. `fuente`: la detectó la IA o la puso una persona. */
export interface ChurnCause {
  clave: string;
  motivo: string | null;
  cita: string | null;
  fuente: "ia" | "manual";
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max).trim() : "");

/** Lee la lista guardada, tolerante: sin clave o repetidas, fuera. */
export function normalizeChurnReasons(raw: unknown): ChurnReason[] {
  const seen = new Set<string>();
  const out: ChurnReason[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!isObj(o)) continue;
    const clave = slugKey(String(o.clave ?? ""));
    const nombre = clip(o.nombre, CHURN_REASON_NAME_MAX);
    if (!clave || !nombre || seen.has(clave)) continue;
    seen.add(clave);
    out.push({ clave, nombre, ...(o.archivado === true ? { archivado: true } : {}) });
    if (out.length >= MAX_CHURN_REASONS) break;
  }
  return out;
}

/** Motivos por los que la lista no se puede guardar (vacío = se puede). */
export function validateChurnReasons(list: ChurnReason[]): string[] {
  const out: string[] = [];
  if (list.length > MAX_CHURN_REASONS) out.push(`Pueden ser hasta ${MAX_CHURN_REASONS} causas.`);
  if (list.some((r) => !r.nombre.trim())) out.push("Hay una causa de baja sin nombre.");
  const names = list.filter((r) => !r.archivado).map((r) => r.nombre.trim().toLowerCase());
  if (new Set(names).size !== names.length) out.push("Hay dos causas de baja con el mismo nombre.");
  return out;
}

/** Una causa nueva a partir de su nombre: la clave no cambia al renombrarla. */
export function newChurnReason(nombre: string, list: ChurnReason[]): ChurnReason {
  return { clave: uniqueKey(nombre, list.map((r) => r.clave)), nombre: nombre.trim().slice(0, CHURN_REASON_NAME_MAX) };
}

export const activeChurnReasons = (list: ChurnReason[]) => list.filter((r) => !r.archivado);

/** El nombre de una clave (archivada incluida: una reunión vieja la sigue mostrando). */
export function churnReasonLabel(clave: string | null | undefined, list: ChurnReason[]): string | null {
  if (!clave) return null;
  return list.find((r) => r.clave === clave)?.nombre ?? clave.replace(/_/g, " ");
}

/**
 * Lo que se le pide a la IA. Obligatorio y puede venir en null (no opcional): Anthropic limita los campos opcionales
 * de un esquema. `clave` null = no hay riesgo de baja en la reunión.
 */
export const churnCauseSchema = z.object({
  clave: z.string().nullable(),
  motivo: z.string().nullable(),
  cita: z.string().nullable(),
});

/** La parte técnica fija que suma la causa de baja. Sin causas activas, cadena vacía. */
export function churnTechnical(list: ChurnReason[]): string {
  const active = activeChurnReasons(list);
  if (!active.length) return "";
  return `

## Causa de baja (campo \`causa_baja\`)
Solo si el cliente dice que se quiere ir, cancelar, pausar o no renovar (o deja claro que lo está pensando), elegí la causa de esta lista:
${active.map((r) => `- ${r.clave}: ${r.nombre}`).join("\n")}
\`clave\` = la clave de la lista; \`motivo\` = una frase con lo que pasa; \`cita\` = la frase TEXTUAL del cliente. Sin una cita textual, o si no habló de irse, devolvé las tres en null. No inventes una causa que no esté en la lista.`;
}

/** Limpia lo que devolvió la IA: clave de la lista activa y cita en la transcripción, o nada. */
export function sanitizeChurnCause(raw: unknown, list: ChurnReason[], transcript: string): ChurnCause | null {
  if (!isObj(raw)) return null;
  const clave = typeof raw.clave === "string" ? raw.clave.trim() : "";
  if (!clave || !activeChurnReasons(list).some((r) => r.clave === clave)) return null;
  const cita = clip(raw.cita, CHURN_QUOTE_MAX);
  if (!quoteInTranscript(cita, transcript)) return null;
  return { clave, motivo: clip(raw.motivo, CHURN_MOTIVE_MAX) || null, cita, fuente: "ia" };
}

/** Lee la causa guardada en el análisis, tolerante. */
export function readChurnCause(analysis: unknown): ChurnCause | null {
  const c = isObj(analysis) && isObj(analysis.causa_baja) ? analysis.causa_baja : null;
  if (!c || typeof c.clave !== "string" || !c.clave.trim()) return null;
  return {
    clave: c.clave.trim(),
    motivo: typeof c.motivo === "string" && c.motivo.trim() ? c.motivo.trim() : null,
    cita: typeof c.cita === "string" && c.cita.trim() ? c.cita.trim() : null,
    fuente: c.fuente === "manual" ? "manual" : "ia",
  };
}

/** Lo que pone una persona desde la reunión: una clave de la lista activa (o nada, para quitarla). */
export function parseManualChurnCause(input: { clave: unknown; motivo: unknown }, list: ChurnReason[]): { ok: true; cause: ChurnCause | null } | { ok: false; error: string } {
  if (input.clave === null || input.clave === "") return { ok: true, cause: null };
  if (typeof input.clave !== "string" || !activeChurnReasons(list).some((r) => r.clave === input.clave)) return { ok: false, error: "Elegí una causa de la lista." };
  const motivo = clip(input.motivo, CHURN_MOTIVE_MAX);
  return { ok: true, cause: { clave: input.clave, motivo: motivo || null, cita: null, fuente: "manual" } };
}
