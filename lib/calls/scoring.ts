/**
 * Puntajes y alertas del analisis de llamadas. Los calcula el CODIGO, nunca la IA.
 *
 * Portado de prevxcrm (`call-analysis-scoring.ts`): sin cambios de logica. El
 * cuerpo del analisis usa las claves en castellano del SPSP (`rubrica`,
 * `lead.creencias`, `alertas`…), que son las que lee la pantalla.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Secciones editables del análisis (ruta con punto dentro de calls.analysis). */
export const ANALYSIS_SECTIONS = [
  "resultado", "momento_quiebre", "dolor", "deseo", "objecion", "resumen", "rubrica",
  "feedback.funciono", "feedback.mejorar", "lead.perfil", "lead.tolerancia", "lead.creencias",
] as const;
export type AnalysisSection = typeof ANALYSIS_SECTIONS[number];

export const SECTION_LABELS: Record<AnalysisSection, string> = {
  resultado: "Resultado y próximo paso", momento_quiebre: "Momento de quiebre", dolor: "Dolor principal",
  deseo: "Deseo principal", objecion: "Objeción principal", resumen: "Resumen del análisis",
  rubrica: "Rúbrica del closer", "feedback.funciono": "Lo que funcionó", "feedback.mejorar": "Qué mejorar",
  "lead.perfil": "Perfil del lead", "lead.tolerancia": "Tolerancia a su situación", "lead.creencias": "Creencias",
};

/** Secciones que pueden tener que cambiar para no contradecir a la corregida. */
export const SECTION_DEPENDENCIES: Record<AnalysisSection, AnalysisSection[]> = {
  resultado: ["resumen", "feedback.mejorar"],
  momento_quiebre: ["resumen", "feedback.mejorar"],
  dolor: ["lead.perfil", "resumen"],
  deseo: ["lead.perfil", "resumen"],
  objecion: ["resumen", "feedback.mejorar", "lead.perfil", "momento_quiebre"],
  resumen: [],
  rubrica: ["feedback.funciono", "feedback.mejorar"],
  "feedback.funciono": [],
  "feedback.mejorar": [],
  "lead.perfil": ["resumen"],
  "lead.tolerancia": ["lead.perfil"],
  "lead.creencias": ["lead.perfil"],
};

export function isAnalysisSection(s: unknown): s is AnalysisSection {
  return typeof s === "string" && (ANALYSIS_SECTIONS as readonly string[]).includes(s);
}

export function getSection(analysis: unknown, section: string): unknown {
  let cur: unknown = analysis;
  for (const k of section.split(".")) { if (!isObj(cur)) return undefined; cur = cur[k]; }
  return cur;
}

export function setSection(analysis: unknown, section: string, value: unknown): Obj {
  const root: Obj = isObj(analysis) ? { ...analysis } : {};
  const [a, b] = section.split(".");
  if (!b) root[a] = value;
  else root[a] = { ...(isObj(root[a]) ? root[a] as Obj : {}), [b]: value };
  return root;
}

/** Puntaje closer 0–100: promedio de la rúbrica 1–5 (con `peso` opcional). */
export function closerScore(rubric: unknown): number | null {
  if (!Array.isArray(rubric)) return null;
  let sum = 0, w = 0;
  for (const r of rubric) {
    if (!isObj(r)) continue;
    const s = Number(r.puntaje);
    if (!Number.isFinite(s) || s < 1 || s > 5) continue;
    const peso = Number(r.peso) > 0 ? Number(r.peso) : 1;
    sum += ((s - 1) / 4) * peso; w += peso;
  }
  return w > 0 ? Math.round((sum / w) * 100) : null;
}

const BELIEF_VALUE: Array<[RegExp, number]> = [
  [/no.?explorad/i, NaN],
  [/(firme|fuerte|instalad|s[ií]\b|presente|alta)/i, 1],
  [/(parcial|media|dud)/i, 0.5],
  [/(d[eé]bil|ausente|no\b|baja|contrari)/i, 0],
];
export function beliefValue(state: unknown): number | null {
  if (typeof state !== "string" || !state.trim()) return null;
  for (const [re, v] of BELIEF_VALUE) if (re.test(state)) return Number.isNaN(v) ? null : v;
  return null;
}

/** Puntaje lead 0–100: creencias exploradas. Las «No explorado» no cuentan. */
export function leadScore(beliefs: unknown): number | null {
  if (!Array.isArray(beliefs)) return null;
  const vals = beliefs.map((b) => beliefValue(isObj(b) ? b.estado : null)).filter((v): v is number => v !== null);
  return vals.length ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 100) : null;
}

export function hasOpenAlerts(alerts: unknown): boolean {
  return Array.isArray(alerts) && alerts.some((a) => !(isObj(a) && a.resuelta === true));
}

export interface AnalysisScores { closer_score: number | null; lead_score: number | null; has_open_alerts: boolean }

export function computeScores(analysis: unknown): AnalysisScores {
  const a = isObj(analysis) ? analysis : {};
  const lead = isObj(a.lead) ? a.lead : {};
  return { closer_score: closerScore(a.rubrica), lead_score: leadScore(lead.creencias), has_open_alerts: hasOpenAlerts(a.alertas) };
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** true si la cita aparece (normalizada) en la transcripción. */
export function quoteInTranscript(quote: string | null | undefined, transcript: string): boolean {
  if (!quote) return false;
  const q = norm(quote);
  return q.length >= 6 && norm(transcript).includes(q);
}

/** Rubrica minima para puntuar (misma forma que `Rubric` de rubric.ts, sin pedirle el resto). */
export interface ScoringRubric {
  closer: { clave: string; nombre?: string; peso: number; aplica_a?: string[]; archivado?: boolean; subtracts?: true }[];
  lead: { clave: string; peso: number; archivado?: boolean }[];
}

/**
 * Lo que resta un criterio «que resta» (F140). Cuenta solo si pasó (puntaje 3 o más) y tiene una cita que está en la
 * transcripción: sin prueba no se le quita nada a nadie.
 */
export interface ScoreDeduction {
  clave: string;
  nombre: string;
  puntaje: number | null;
  /** Puntos que quita (0 si no cuenta). */
  puntos: number;
  cita: string | null;
  /** Por qué no cuenta, si no cuenta. */
  motivo: "no_paso" | "sin_cita" | "cita_no_esta" | null;
}

/** Cómo sale la nota de 0 a 100: la media de los criterios que suman, lo que resta cada criterio que resta y el total. */
export interface ScoreBreakdown {
  base: number | null;
  restas: ScoreDeduction[];
  total: number | null;
}

export interface AnalysisScoresWithBreakdown extends AnalysisScores {
  /** null sin rúbrica o sin criterios que restan: la nota es la media de siempre y no hace falta desglose. */
  breakdown: ScoreBreakdown | null;
}

function summingWeight(items: Obj[]): number {
  let w = 0;
  for (const r of items) {
    const s = Number(r.puntaje);
    if (!Number.isFinite(s) || s < 1 || s > 5) continue;
    w += Number(r.peso) > 0 ? Number(r.peso) : 1;
  }
  return w;
}

/** Lo que resta cada criterio que resta, en puntos sobre 100. Sin transcripción ninguno cuenta. */
export function scoreDeductions(
  items: Obj[],
  penalties: Array<{ clave: string; nombre: string; peso: number; puntaje: unknown; cita: unknown }>,
  transcriptText: string | null,
): ScoreDeduction[] {
  const w = summingWeight(items);
  return penalties.map((p) => {
    const raw = Number(p.puntaje);
    const puntaje = Number.isFinite(raw) && raw >= 1 && raw <= 5 ? raw : null;
    const cita = typeof p.cita === "string" && p.cita.trim() ? p.cita.trim() : null;
    let motivo: ScoreDeduction["motivo"] = null;
    if (puntaje === null || puntaje < 3) motivo = "no_paso";
    else if (!cita) motivo = "sin_cita";
    else if (!transcriptText || !quoteInTranscript(cita, transcriptText)) motivo = "cita_no_esta";
    const puntos = motivo || w <= 0 ? 0 : Math.round(((p.peso > 0 ? p.peso : 1) / w) * 100);
    return { clave: p.clave, nombre: p.nombre, puntaje, puntos, cita, motivo };
  });
}

/**
 * El puntaje con criterios que restan (F140): el de siempre sobre los criterios que suman, menos el peso (relativo) de
 * cada criterio que resta y que pasó (puntaje 3 o más) CON una cita que está en la transcripción. Nunca baja de 0.
 * Sin criterios que restan, es exactamente `closerScore`.
 */
export function closerScoreWithPenalties(
  items: Obj[],
  penalties: Array<{ peso: number; puntaje: unknown; cita: unknown }>,
  transcriptText: string | null,
): number | null {
  const base = closerScore(items);
  if (penalties.length === 0 || base === null) return base;
  const minus = scoreDeductions(items, penalties.map((p, i) => ({ ...p, clave: String(i), nombre: "" })), transcriptText).reduce((a, d) => a + d.puntos, 0);
  return Math.max(0, base - minus);
}

/** Puntajes usando los pesos y el «Aplica a» de la rúbrica publicada, con el desglose de la nota si hay criterios que restan. */
export function computeScoresWithRubric(analysis: unknown, rubric: ScoringRubric | null, callType: string | null, transcriptText: string | null = null): AnalysisScoresWithBreakdown {
  const base = computeScores(analysis);
  if (!rubric) return { ...base, breakdown: null };
  const a = isObj(analysis) ? analysis : {};
  const applies = rubric.closer.filter((c) => !c.archivado && (!callType || !c.aplica_a || c.aplica_a.includes(callType)));
  const cw = new Map(applies.filter((c) => !c.subtracts).map((c) => [c.clave, c.peso]));
  const sw = new Map(applies.filter((c) => c.subtracts).map((c) => [c.clave, c]));
  const all = Array.isArray(a.rubrica) ? a.rubrica.filter(isObj) : [];
  const items = all.filter((r) => cw.has(String(r.codigo))).map((r) => ({ ...r, peso: cw.get(String(r.codigo)) }));
  // Cada criterio que resta de la rúbrica figura en el desglose, aunque la IA no lo haya devuelto (cuenta como «no pasó»).
  const penalties = [...sw.values()].map((c) => {
    const r = all.find((x) => String(x.codigo) === c.clave);
    return { clave: c.clave, nombre: String(r?.nombre ?? c.nombre ?? c.clave), peso: c.peso, puntaje: r?.puntaje, cita: r?.cita };
  });
  const lw = new Map(rubric.lead.filter((c) => !c.archivado).map((c) => [c.clave, c.peso]));
  const lead = isObj(a.lead) ? a.lead : {};
  let ls = 0, lt = 0;
  for (const b of Array.isArray(lead.creencias) ? lead.creencias : []) {
    if (!isObj(b)) continue;
    const w = lw.get(String(b.codigo ?? ""));
    const v = beliefValue(b.estado);
    if (!w || v === null) continue;
    ls += v * w; lt += w;
  }
  const media = items.length ? closerScore(items) : base.closer_score;
  let closer = media;
  let breakdown: ScoreBreakdown | null = null;
  if (items.length && penalties.length) {
    const restas = scoreDeductions(items, penalties, transcriptText);
    closer = media === null ? null : Math.max(0, media - restas.reduce((s, d) => s + d.puntos, 0));
    breakdown = { base: media, restas, total: closer };
  }
  return {
    closer_score: closer,
    lead_score: lt > 0 ? Math.round((ls / lt) * 100) : base.lead_score,
    has_open_alerts: base.has_open_alerts,
    breakdown,
  };
}

const DEDUCTION_REASONS: Record<NonNullable<ScoreDeduction["motivo"]>, string> = {
  no_paso: "No pasó",
  sin_cita: "No cuenta: sin cita",
  cita_no_esta: "No cuenta: la cita no está en la transcripción",
};

/** El texto de por qué un criterio que resta no quitó puntos. */
export function deductionReason(d: ScoreDeduction): string | null {
  return d.motivo ? DEDUCTION_REASONS[d.motivo] : null;
}

const DEDUCTION_MOTIVOS = new Set(["no_paso", "sin_cita", "cita_no_esta"]);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lee `analysis.nota` (lo guarda el analizador), tolerante a lo que falte. Sin nota guardada, null. */
export function readScoreBreakdown(analysis: unknown): ScoreBreakdown | null {
  const n = isObj(analysis) && isObj(analysis.nota) ? analysis.nota : null;
  if (!n) return null;
  const restas = (Array.isArray(n.restas) ? n.restas : []).filter(isObj).map((d): ScoreDeduction => ({
    clave: String(d.clave ?? ""),
    nombre: String(d.nombre ?? d.clave ?? ""),
    puntaje: numOrNull(d.puntaje),
    puntos: numOrNull(d.puntos) ?? 0,
    cita: typeof d.cita === "string" ? d.cita : null,
    motivo: DEDUCTION_MOTIVOS.has(String(d.motivo)) ? (d.motivo as ScoreDeduction["motivo"]) : null,
  })).filter((d) => d.clave);
  return { base: numOrNull(n.base), restas, total: numOrNull(n.total) };
}
