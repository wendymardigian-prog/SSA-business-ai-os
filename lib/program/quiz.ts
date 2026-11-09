// @plantilla-quitar(servicios)
/**
 * La evaluación automática (F53, F54), pura. Gemela de `app_servicio.quiz_grade_plan(jsonb)` (00345); los casos de
 * `quiz-grade.cases.json` corren contra las dos. Las preguntas son campos de selección única o múltiple del formulario;
 * la corrección vive en `definition.quiz.questions[<clave>]` y NUNCA viaja al portal.
 */
export interface QuizQuestion {
  points: number;
  correct: string[];
  /** Solo en múltiple: puntaje parcial (aciertos − errores, sin bajar de 0). Si no, todo o nada. */
  partial?: boolean;
}

export interface QuizSettings {
  pass_pct?: number;
  attempts?: number;
  show_grade?: boolean;
  show_correct?: boolean;
  questions?: Record<string, QuizQuestion>;
}

export interface QuizGrade {
  total: number;
  earned: number;
  pct: number;
  passed: boolean;
  counted: boolean;
  per_question: Record<string, { earned: number; points: number; correct: boolean }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v !== "" ? [v] : []);

export function gradeQuiz(settings: QuizSettings, answers: Record<string, unknown>, attempt: number): QuizGrade {
  const qs = settings.questions ?? {};
  const per: QuizGrade["per_question"] = {};
  let total = 0;
  let earned = 0;
  for (const key of Object.keys(qs).sort()) {
    const q = qs[key];
    const points = Number(q.points) > 0 ? Number(q.points) : 0;
    total += points;
    const given = new Set(asList(answers[key]));
    const correct = new Set(q.correct ?? []);
    const exact = given.size === correct.size && [...given].every((g) => correct.has(g));
    let got = 0;
    if (exact) got = points;
    else if (q.partial && correct.size > 0) {
      const hits = [...given].filter((g) => correct.has(g)).length;
      const misses = given.size - hits;
      got = Math.max(0, round2((points * (hits - misses)) / correct.size));
    }
    earned += got;
    per[key] = { earned: got, points, correct: exact };
  }
  const pct = total > 0 ? round2((earned / total) * 100) : 0;
  const passPct = typeof settings.pass_pct === "number" ? settings.pass_pct : 70;
  const attempts = typeof settings.attempts === "number" && settings.attempts > 0 ? settings.attempts : 1;
  return { total: round2(total), earned: round2(earned), pct, passed: pct >= passPct, counted: attempt <= attempts, per_question: per };
}

/** Problemas de una evaluación antes de guardar (F53). */
export function quizDefinitionIssues(settings: QuizSettings, fields: Array<{ key: string; type: string; options?: string[] }>): string[] {
  const p: string[] = [];
  const pass = settings.pass_pct ?? 70;
  if (!(Number.isInteger(pass) && pass >= 1 && pass <= 100)) p.push("el % para aprobar va de 1 a 100");
  if (!(Number.isInteger(settings.attempts ?? 1) && (settings.attempts ?? 1) >= 1 && (settings.attempts ?? 1) <= 20)) p.push("los intentos van de 1 a 20");
  const qs = settings.questions ?? {};
  if (Object.keys(qs).length === 0) p.push("agregá al menos una pregunta");
  for (const [key, q] of Object.entries(qs)) {
    const f = fields.find((x) => x.key === key);
    if (!f || (f.type !== "single_select" && f.type !== "multi_select")) {
      p.push(`«${key}»: solo preguntas de selección`);
      continue;
    }
    if (!(Number(q.points) > 0)) p.push(`«${key}»: los puntos tienen que ser más que 0`);
    const correct = q.correct ?? [];
    if (correct.length === 0) p.push(`«${key}»: marcá la respuesta correcta`);
    if (correct.some((c) => !(f.options ?? []).includes(c))) p.push(`«${key}»: la correcta tiene que ser una de las opciones`);
    if (f.type === "single_select" && correct.length > 1) p.push(`«${key}»: en selección única hay una sola correcta`);
    if (f.type === "multi_select" && correct.length === (f.options ?? []).length) p.push(`«${key}»: no pueden ser todas correctas`);
  }
  return p;
}
