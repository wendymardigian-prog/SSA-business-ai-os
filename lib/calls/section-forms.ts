/**
 * Como se edita cada seccion del analisis a mano (F23): la forma del
 * formulario de cada una, y como se muestra un valor en texto (para comparar
 * "antes" y "despues" en una correccion con IA). Puro.
 *
 * Una sola tabla para las doce secciones: si se suma una a `ANALYSIS_SECTIONS`,
 * el test de abajo falla hasta que tenga su formulario.
 */
import { ANALYSIS_SECTIONS, type AnalysisSection } from "./scoring";
import { BELIEF_STATES } from "./analysis-schema";
import { OUTCOME_CATEGORIES, type CategoryGroup } from "./rubric";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

export interface FieldSpec {
  key: string;
  label: string;
  kind: "text" | "textarea" | "bool" | "select";
  options?: readonly string[];
  /** Las categorias aceptadas de este grupo se ofrecen como sugerencia. */
  suggestFrom?: CategoryGroup;
}

export type SectionForm =
  /** Un texto. */
  | { kind: "text" }
  /** Un objeto con campos fijos. */
  | { kind: "object"; fields: FieldSpec[] }
  /** Una lista de textos (se agregan y se sacan). */
  | { kind: "strings" }
  /** Una lista de objetos. `fixedBy`: las filas las pone el analisis (una por criterio) y no se agregan ni se sacan. */
  | { kind: "list"; fields: FieldSpec[]; fixedBy?: string; labelKey?: string };

const DEPTH = ["mencionado", "profundizado", "cuantificado"] as const;
const SCORES = ["1", "2", "3", "4", "5"] as const;

export const SECTION_FORMS: Record<AnalysisSection, SectionForm> = {
  resumen: { kind: "text" },
  "lead.perfil": { kind: "text" },
  "lead.tolerancia": { kind: "text" },
  resultado: {
    kind: "object",
    fields: [
      { key: "categoria", label: "Resultado", kind: "select", options: OUTCOME_CATEGORIES },
      { key: "fecha", label: "Fecha del próximo paso (AAAA-MM-DD)", kind: "text" },
      { key: "proximo_paso", label: "Próximo paso", kind: "textarea" },
      { key: "agendada_en_llamada", label: "Quedó agendado durante la llamada", kind: "bool" },
    ],
  },
  momento_quiebre: {
    kind: "object",
    fields: [
      { key: "descripcion", label: "Qué pasó", kind: "textarea" },
      { key: "cita", label: "Cita textual", kind: "text" },
      { key: "timestamp", label: "Minuto", kind: "text" },
      { key: "frase_sugerida", label: "Frase sugerida", kind: "textarea" },
    ],
  },
  dolor: {
    kind: "object",
    fields: [
      { key: "texto", label: "Dolor", kind: "textarea" },
      { key: "categoria", label: "Categoría", kind: "text", suggestFrom: "dolores" },
      { key: "profundidad", label: "Profundidad", kind: "select", options: DEPTH },
      { key: "cita", label: "Cita textual", kind: "text" },
      { key: "timestamp", label: "Minuto", kind: "text" },
    ],
  },
  deseo: {
    kind: "object",
    fields: [
      { key: "texto", label: "Deseo", kind: "textarea" },
      { key: "categoria", label: "Categoría", kind: "text", suggestFrom: "deseos" },
    ],
  },
  objecion: {
    kind: "object",
    fields: [
      { key: "dijo", label: "Lo que dijo", kind: "textarea" },
      { key: "de_fondo", label: "Lo de fondo", kind: "textarea" },
      { key: "categoria", label: "Categoría", kind: "text", suggestFrom: "objeciones" },
      { key: "cita", label: "Cita textual", kind: "text" },
      { key: "timestamp", label: "Minuto", kind: "text" },
      { key: "respondida", label: "Se respondió", kind: "bool" },
      { key: "resuelta", label: "Se resolvió", kind: "bool" },
    ],
  },
  rubrica: {
    kind: "list",
    fixedBy: "codigo",
    labelKey: "nombre",
    fields: [
      { key: "puntaje", label: "Puntaje (1 a 5)", kind: "select", options: SCORES },
      { key: "justificacion", label: "Justificación", kind: "textarea" },
      { key: "cita", label: "Cita textual", kind: "text" },
      { key: "timestamp", label: "Minuto", kind: "text" },
    ],
  },
  "feedback.funciono": { kind: "strings" },
  "feedback.mejorar": {
    kind: "list",
    fields: [
      { key: "texto", label: "Qué mejorar", kind: "textarea" },
      { key: "frase_sugerida", label: "Frase sugerida", kind: "textarea" },
    ],
  },
  "lead.creencias": {
    kind: "list",
    fixedBy: "codigo",
    labelKey: "nombre",
    fields: [
      { key: "estado", label: "Estado", kind: "select", options: BELIEF_STATES },
      { key: "evidencia", label: "Evidencia", kind: "textarea" },
    ],
  },
};

/** Una fila nueva de una lista que se puede agrandar (todo vacio). */
export function blankItem(section: AnalysisSection): Obj {
  const form = SECTION_FORMS[section];
  if (form.kind !== "list") return {};
  return Object.fromEntries(form.fields.map((f) => [f.key, f.kind === "bool" ? false : ""]));
}

/** Lo que el formulario devuelve: el puntaje vuelve a numero y los campos vacios se sacan. */
export function cleanFormValue(section: AnalysisSection, value: unknown): unknown {
  const form = SECTION_FORMS[section];
  const clean = (o: Obj): Obj => {
    const out: Obj = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "puntaje") out[k] = Number(v);
      else if (typeof v === "string" && v.trim() === "") continue;
      else out[k] = typeof v === "string" ? v.trim() : v;
    }
    return out;
  };
  if (form.kind === "object") return isObj(value) ? clean(value) : value;
  if (form.kind === "list") return Array.isArray(value) ? value.filter(isObj).map(clean) : value;
  if (form.kind === "strings") return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : value;
  return typeof value === "string" ? value.trim() : value;
}

const label = (section: AnalysisSection, key: string): string => {
  const form = SECTION_FORMS[section];
  const fields = form.kind === "object" || form.kind === "list" ? form.fields : [];
  return fields.find((f) => f.key === key)?.label ?? key;
};
const scalar = (v: unknown): string => (v === true ? "Sí" : v === false ? "No" : v === null || v === undefined || v === "" ? "—" : String(v));

/** Un valor en texto legible, para mostrar el antes y el despues. */
export function describeSectionValue(section: AnalysisSection, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const form = SECTION_FORMS[section];
  if (form.kind === "text") return scalar(value);
  if (form.kind === "strings") return Array.isArray(value) && value.length ? value.map((v) => `• ${scalar(v)}`).join("\n") : "—";
  if (form.kind === "object") {
    if (!isObj(value)) return scalar(value);
    return Object.entries(value).map(([k, v]) => `${label(section, k)}: ${scalar(v)}`).join("\n") || "—";
  }
  if (!Array.isArray(value) || value.length === 0) return "—";
  return value
    .filter(isObj)
    .map((item) => {
      const head = form.labelKey && item[form.labelKey] ? `${scalar(item[form.labelKey])}\n` : "";
      const body = Object.entries(item)
        .filter(([k]) => k !== form.labelKey && k !== form.fixedBy)
        .map(([k, v]) => `  ${label(section, k)}: ${scalar(v)}`)
        .join("\n");
      return `${head}${body}`;
    })
    .join("\n\n");
}

export const EDITABLE_SECTIONS = ANALYSIS_SECTIONS;
