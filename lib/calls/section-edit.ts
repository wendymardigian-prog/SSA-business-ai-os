/**
 * Editar secciones del analisis de una llamada (F23, F24). Puro.
 *
 * Lo que corrige una persona (o acepta de una propuesta de IA) se aplica sobre
 * `analysis`; `analysis_ai` —lo que dijo la IA— no se toca nunca. Despues de
 * cada cambio, los puntajes y lo que se copia a las columnas se RECALCULAN con
 * la rubrica con la que se analizo (`rubric_snapshot`), no con la vigente: un
 * cambio posterior de la rubrica no altera puntajes viejos.
 */
import { collectQuotes, leadQualification, validFollowupDate, analyzerCallType } from "./analysis-store";
import { BELIEF_STATES } from "./analysis-schema";
import { OUTCOME_CATEGORIES } from "./rubric";
import { computeScoresWithRubric, getSection, isAnalysisSection, quoteInTranscript, setSection, type AnalysisSection, type ScoringRubric } from "./scoring";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const MAX_SECTION_BYTES = 50_000;
export const MAX_EDITS_PER_SAVE = 6;

export interface SectionEdit {
  section: string;
  value: unknown;
}

const nonEmptyStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** El motivo por el que un valor no sirve para esa seccion, o null si sirve. */
export function validateSectionValue(section: string, value: unknown): string | null {
  if (!isAnalysisSection(section)) return "Esa sección no se puede editar";
  if (value === undefined || value === null) return "La sección no puede quedar vacía";
  let size = 0;
  try {
    size = JSON.stringify(value).length;
  } catch {
    return "El contenido no es válido";
  }
  if (size > MAX_SECTION_BYTES) return "El contenido es demasiado largo";

  switch (section) {
    case "resumen":
    case "lead.perfil":
    case "lead.tolerancia":
      return typeof value === "string" && value.trim() ? null : "Escribí el texto de la sección";
    case "resultado":
      return isObj(value) && (OUTCOME_CATEGORIES as readonly string[]).includes(String(value.categoria)) ? null : "El resultado necesita una categoría válida";
    case "momento_quiebre":
    case "dolor":
    case "deseo":
    case "objecion":
      return isObj(value) ? null : "El contenido no tiene la forma de esa sección";
    case "rubrica":
      return Array.isArray(value) && value.every((r) => isObj(r) && str(r.codigo) && Number.isInteger(r.puntaje) && (r.puntaje as number) >= 1 && (r.puntaje as number) <= 5)
        ? null
        : "Cada criterio necesita su código y un puntaje de 1 a 5";
    case "feedback.funciono":
      return nonEmptyStrings(value) ? null : "Cada punto tiene que ser un texto";
    case "feedback.mejorar":
      return Array.isArray(value) && value.every((m) => isObj(m) && str(m.texto)) ? null : "Cada mejora necesita su texto";
    case "lead.creencias":
      return Array.isArray(value) && value.every((b) => isObj(b) && str(b.codigo) && (BELIEF_STATES as readonly string[]).includes(String(b.estado)))
        ? null
        : "Cada creencia necesita su código y un estado: Firme, Parcial, Débil o No explorado";
  }
}

export interface DerivedColumns {
  closer_score: number | null;
  lead_score: number | null;
  has_open_alerts: boolean;
  lead_qualification: "calificado" | "con_reservas" | "no_calificado" | null;
  outcome: string | null;
  main_objection: string | null;
  followup_at: string | null;
  quotes_total: number;
  quotes_verified: number;
}

/** Lo que se copia del analisis a las columnas de `calls`, con los puntajes recalculados por codigo. */
export function deriveColumns(analysis: unknown, rubric: ScoringRubric | null, callType: string | null, transcript: string): DerivedColumns {
  const a = isObj(analysis) ? analysis : {};
  const scores = computeScoresWithRubric(a, rubric, analyzerCallType(callType));
  const resultado = isObj(a.resultado) ? a.resultado : {};
  const objecion = isObj(a.objecion) ? a.objecion : {};
  const outcome = str(resultado.categoria);
  const quotes = collectQuotes(a);
  return {
    closer_score: scores.closer_score,
    lead_score: scores.lead_score,
    has_open_alerts: scores.has_open_alerts,
    lead_qualification: leadQualification(scores.lead_score, outcome) as DerivedColumns["lead_qualification"],
    outcome,
    main_objection: str(objecion.categoria),
    followup_at: validFollowupDate(resultado.fecha),
    quotes_total: quotes.length,
    quotes_verified: quotes.filter((q) => quoteInTranscript(q, transcript)).length,
  };
}

export type ApplyEditsResult =
  | { ok: true; analysis: Obj; columns: DerivedColumns; changes: Array<{ section: string; before: unknown; after: unknown }> }
  | { ok: false; error: string };

/** Aplica varias ediciones juntas (una seccion y sus dependientes) y recalcula. Si una no vale, no se aplica ninguna. */
export function applySectionEdits(
  analysis: unknown,
  edits: SectionEdit[],
  ctx: { rubric: ScoringRubric | null; callType: string | null; transcript: string },
): ApplyEditsResult {
  if (!isObj(analysis)) return { ok: false, error: "La llamada todavía no tiene análisis" };
  if (edits.length === 0) return { ok: false, error: "No hay nada para guardar" };
  if (edits.length > MAX_EDITS_PER_SAVE) return { ok: false, error: "Son demasiados cambios juntos" };
  const seen = new Set<string>();
  for (const e of edits) {
    if (seen.has(e.section)) return { ok: false, error: "Una sección está repetida" };
    seen.add(e.section);
    const problem = validateSectionValue(e.section, e.value);
    if (problem) return { ok: false, error: problem };
  }

  let next: Obj = analysis;
  const changes: Array<{ section: string; before: unknown; after: unknown }> = [];
  for (const e of edits) {
    changes.push({ section: e.section, before: getSection(analysis, e.section) ?? null, after: e.value });
    next = setSection(next, e.section, e.value);
  }

  const columns = deriveColumns(next, ctx.rubric, ctx.callType, ctx.transcript);
  // Lo que el analisis guarda duplicado para la pantalla se mantiene al dia.
  next = {
    ...next,
    closer_score: columns.closer_score,
    lead_score: columns.lead_score,
    has_open_alerts: columns.has_open_alerts,
    outcome: columns.outcome,
    followup_at: columns.followup_at,
    main_objection: columns.main_objection,
    lead_qualification: columns.lead_qualification,
    citas_verificadas: { total: columns.quotes_total, verificadas: columns.quotes_verified },
  };
  return { ok: true, analysis: next, columns, changes };
}

export function isEditableSection(section: unknown): section is AnalysisSection {
  return isAnalysisSection(section);
}
