// @plantilla-quitar(proyectos)
/**
 * Los problemas de un proyecto del estudiante, en palabras (F78, F232). Gemela de
 * `app_servicio_proyectos.project_problems(jsonb)` (00395): los casos de `student-project.cases.json` corren contra las dos.
 * Las CHECK de la tabla son la red; esto da el texto para mostrar.
 */
export type ProjectKind = "real" | "practice" | "challenge";
export type ProjectStatus = "draft" | "proposal_sent" | "won" | "in_build" | "delivered" | "lost";

export const PROJECT_KINDS: readonly ProjectKind[] = ["real", "practice", "challenge"];
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["draft", "proposal_sent", "won", "in_build", "delivered", "lost"];
/** Desde Ganado, la venta está cerrada: lleva fecha de cierre y cuenta como vendido. */
export const CLOSED_STATUSES: readonly ProjectStatus[] = ["won", "in_build", "delivered"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function projectProblems(p: unknown): string[] {
  if (!isObj(p)) return ["el proyecto no es válido"];
  const k = p.kind;
  if (typeof k !== "string" || !(PROJECT_KINDS as readonly string[]).includes(k)) return ["elegí el tipo de proyecto"];
  const v: string[] = [];
  if (typeof p.title !== "string" || p.title.trim().length < 1 || p.title.trim().length > 200) v.push("escribí el nombre del proyecto (hasta 200 caracteres)");
  if (k === "practice") {
    if (has(p, "client") && p.client !== null) v.push("un proyecto de práctica no tiene cliente");
    if (has(p, "sold_cents") && p.sold_cents !== null) v.push("un proyecto de práctica no tiene monto");
    if (has(p, "status") && p.status !== null) v.push("un proyecto de práctica no tiene estado de venta");
  }
  if (k === "challenge" && (typeof p.service_id !== "string" || typeof p.phase_key !== "string")) v.push("un proyecto del reto va ligado a la fase Reto de tu servicio");
  if (k === "real") {
    const st = p.status;
    if (typeof st !== "string" || !(PROJECT_STATUSES as readonly string[]).includes(st)) v.push("elegí el estado del proyecto");
    else if ((CLOSED_STATUSES as readonly string[]).includes(st) && !(typeof p.closed_on === "string" && DATE.test(p.closed_on))) v.push("desde Ganado, la fecha de cierre es obligatoria");
    if (has(p, "client") && p.client !== null && !isObj(p.client)) v.push("los datos del cliente no son válidos");
    if (has(p, "sold_cents") && p.sold_cents !== null && !(typeof p.sold_cents === "number" && p.sold_cents >= 0 && Number.isInteger(p.sold_cents))) {
      v.push("el monto vendido tiene que ser un número positivo");
    }
  }
  if (has(p, "phases")) {
    if (!Array.isArray(p.phases)) v.push("las fases del proyecto no son válidas");
    else {
      const seen = new Set<string>();
      for (const ph of p.phases) {
        if (!isObj(ph) || typeof ph.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(ph.key) || typeof ph.name !== "string" || !ph.name.trim()) {
          v.push("hay una fase sin nombre");
          continue;
        }
        if (seen.has(ph.key)) v.push(`la fase ${ph.name} está repetida`);
        seen.add(ph.key);
        if (k === "practice") {
          v.push("un proyecto de práctica no se vende por fases");
          break;
        }
        if (has(ph, "price_cents") && ph.price_cents !== null && !(typeof ph.price_cents === "number" && ph.price_cents >= 0)) v.push(`el precio de la fase ${ph.name} no es válido`);
      }
    }
  }
  return v;
}
