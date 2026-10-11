/**
 * Arma el objeto que se guarda en `calls.analysis_ai` y `calls.analysis` a
 * partir de la salida del analizador. Las claves de primer nivel se copian a las
 * columnas de `calls`. Los puntajes vienen del CODIGO, nunca de la IA.
 *
 * Portado de prevxcrm (`call-analysis-store.ts`). Cambios: sin `thinkingLevel`,
 * y la version del prompt es un numero (`prompt_version`), no un id.
 */
import { hasOpenAlerts, quoteInTranscript } from "./scoring";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Si la regla dijo "venta" sin subtipo (o no hay tipo), se analiza como cierre. */
export function analyzerCallType(callType: string | null | undefined): string {
  const t = (callType ?? "").trim();
  return !t || t === "venta" ? "cierre" : t;
}

/** ISO válido (YYYY-MM-DD o fecha-hora) o null. */
export function validFollowupDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function leadQualification(leadScore: number | null, outcome: string | null): string | null {
  if (outcome === "no_calificaba") return "no_calificado";
  if (leadScore === null) return null;
  if (leadScore >= 65) return "calificado";
  if (leadScore >= 45) return "con_reservas";
  return "no_calificado";
}

/** Citas de la rúbrica, el dolor, la objeción y el momento de quiebre. */
export function collectQuotes(analysis: unknown): string[] {
  const a = isObj(analysis) ? analysis : {};
  const out: string[] = [];
  if (Array.isArray(a.rubrica)) for (const r of a.rubrica) { const c = isObj(r) ? str(r.cita) : null; if (c) out.push(c); }
  for (const k of ["dolor", "objecion", "momento_quiebre"]) {
    const c = isObj(a[k]) ? str((a[k] as Obj).cita) : null;
    if (c) out.push(c);
  }
  return out;
}

export interface StoredAnalysisInput {
  analysis: Obj;
  scores: { closer_score: number | null; lead_score: number | null };
  transcriptText: string;
  model: string;
  costUsd: number;
  /** La version activa de las instrucciones (`ai_task_prompt_versions.version`); null = el texto del sistema. */
  promptVersion: number | null;
  rubricVersion: number | null;
  generatedAt: string;
}

export function buildStoredAnalysis(i: StoredAnalysisInput): Obj {
  const a = i.analysis;
  const resultado = isObj(a.resultado) ? a.resultado : {};
  const objecion = isObj(a.objecion) ? a.objecion : {};
  const outcome = str(resultado.categoria);
  const quotes = collectQuotes(a);
  return {
    ...a,
    closer_score: i.scores.closer_score,
    lead_score: i.scores.lead_score,
    has_open_alerts: hasOpenAlerts(a.alertas),
    outcome,
    followup_at: validFollowupDate(resultado.fecha),
    main_objection: str(objecion.categoria),
    lead_qualification: leadQualification(i.scores.lead_score, outcome),
    prompt_version: i.promptVersion,
    rubric_version: i.rubricVersion,
    model: i.model,
    cost_usd: Math.round((Number(i.costUsd) || 0) * 1_000_000) / 1_000_000,
    generated_at: i.generatedAt,
    citas_verificadas: {
      total: quotes.length,
      verificadas: quotes.filter((q) => quoteInTranscript(q, i.transcriptText)).length,
    },
  };
}
