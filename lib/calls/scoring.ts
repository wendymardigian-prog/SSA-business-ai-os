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
  closer: { clave: string; peso: number; aplica_a?: string[]; archivado?: boolean }[];
  lead: { clave: string; peso: number; archivado?: boolean }[];
}

/** Puntajes usando los pesos y el «Aplica a» de la rúbrica publicada. */
export function computeScoresWithRubric(analysis: unknown, rubric: ScoringRubric | null, callType: string | null): AnalysisScores {
  const base = computeScores(analysis);
  if (!rubric) return base;
  const a = isObj(analysis) ? analysis : {};
  const cw = new Map(rubric.closer.filter((c) => !c.archivado && (!callType || !c.aplica_a || c.aplica_a.includes(callType))).map((c) => [c.clave, c.peso]));
  const items = Array.isArray(a.rubrica)
    ? a.rubrica.filter(isObj).filter((r) => cw.has(String(r.codigo))).map((r) => ({ ...r, peso: cw.get(String(r.codigo)) }))
    : [];
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
  return {
    closer_score: items.length ? closerScore(items) : base.closer_score,
    lead_score: lt > 0 ? Math.round((ls / lt) * 100) : base.lead_score,
    has_open_alerts: base.has_open_alerts,
  };
}
