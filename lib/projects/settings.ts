// @plantilla-quitar(proyectos)
/**
 * La forma de `products.portal_settings.fame` (F80) y `.projects` (F118, F119). Gemelas de
 * `app_servicio_proyectos.fame_settings_problems` y `projects_settings_problems` (00395); los casos de
 * `settings.cases.json` corren contra las dos. Solo se validan con la extensión prendida: sin ella, las claves son
 * desconocidas (lo dice el validador del programa).
 *
 * Los pasos del método son DATOS (decisión 438): nombre, de qué pasos anteriores usa documentos, las instrucciones
 * del prompt y del análisis (cada una con su versión), las tareas típicas y la clase que lo explica.
 */
import { unknownKeyProblems as unknownKeys } from "@/lib/services/json-order";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fameSettingsProblems(f: unknown): string[] {
  if (!isObj(f)) return ["la Sala de la fama no es válida"];
  const v = unknownKeys(f, ["counts", "verified_only", "include_before_program", "milestones", "first_project_milestone"]);
  if (has(f, "counts") && f.counts !== "paid" && f.counts !== "sold") v.push("elegí qué cuenta: lo cobrado o lo vendido");
  if (["verified_only", "include_before_program", "first_project_milestone"].some((k) => has(f, k) && typeof f[k] !== "boolean")) {
    v.push("las opciones de la Sala de la fama tienen que ser sí o no");
  }
  if (has(f, "milestones")) {
    const m = f.milestones;
    if (!Array.isArray(m) || m.length > 10) v.push("los hitos tienen que ser una lista de hasta 10 montos");
    else {
      let prev = 0;
      for (const x of m) {
        if (!isInt(x) || x <= prev) {
          v.push("los hitos van de menor a mayor, en montos positivos");
          break;
        }
        prev = x;
      }
    }
  }
  return v;
}

const STEP_KEYS = ["key", "name", "description", "depends_on", "prompt", "analysis", "tasks", "lesson_item_id", "fields"];

export function projectsSettingsProblems(p: unknown): string[] {
  if (!isObj(p)) return ["Mis proyectos no es válido"];
  const v = unknownKeys(p, ["reviewer_agent_id", "steps", "budget_ranges"]);
  if (has(p, "reviewer_agent_id") && p.reviewer_agent_id !== null && !(typeof p.reviewer_agent_id === "string" && UUID.test(p.reviewer_agent_id))) v.push("el revisor no es válido");
  if (has(p, "steps")) {
    if (!Array.isArray(p.steps) || p.steps.length > 20) v.push("los pasos tienen que ser una lista de hasta 20");
    else {
      const seen: string[] = [];
      for (const st of p.steps) {
        if (!isObj(st) || typeof st.key !== "string" || !/^[a-z0-9_]{1,40}$/.test(st.key) || typeof st.name !== "string" || st.name.trim().length < 1 || st.name.trim().length > 80) {
          v.push("hay un paso sin nombre o con una clave inválida");
          continue;
        }
        v.push(...unknownKeys(st, STEP_KEYS));
        if (seen.includes(st.key)) v.push(`el paso ${st.name} está repetido`);
        if (has(st, "depends_on")) {
          if (!Array.isArray(st.depends_on)) v.push(`${st.name}: los documentos que usa no son válidos`);
          else if (st.depends_on.some((d) => typeof d !== "string" || !seen.includes(d))) v.push(`${st.name}: solo puede usar documentos de pasos anteriores`);
        }
        for (const t of [st.prompt, st.analysis]) {
          if (t === undefined || t === null) continue;
          if (!(isObj(t) && typeof t.text === "string" && t.text.length <= 50000 && isInt(t.version) && t.version >= 1)) v.push(`${st.name}: las instrucciones no son válidas`);
        }
        if (has(st, "tasks") && !(Array.isArray(st.tasks) && st.tasks.length <= 20 && st.tasks.every((x) => typeof x === "string" && x.length >= 1 && x.length <= 200))) {
          v.push(`${st.name}: las tareas no son válidas`);
        }
        if (has(st, "lesson_item_id") && st.lesson_item_id !== null && !(typeof st.lesson_item_id === "string" && UUID.test(st.lesson_item_id))) v.push(`${st.name}: la clase no es válida`);
        seen.push(st.key);
      }
    }
  }
  if (has(p, "budget_ranges")) {
    if (!Array.isArray(p.budget_ranges)) v.push("los rangos de presupuesto no son válidos");
    else {
      const sizes: string[] = [];
      for (const b of p.budget_ranges) {
        if (!isObj(b) || !["small", "medium", "large"].includes(b.size as string) || !isInt(b.min_cents) || !isInt(b.max_cents) || b.min_cents < 0) {
          v.push("cada rango lleva tamaño, mínimo y máximo");
          continue;
        }
        if (b.min_cents > b.max_cents) v.push(`el rango ${b.size} tiene el mínimo mayor que el máximo`);
        if (sizes.includes(b.size as string)) v.push(`el rango ${b.size} está repetido`);
        sizes.push(b.size as string);
      }
    }
  }
  return v;
}
