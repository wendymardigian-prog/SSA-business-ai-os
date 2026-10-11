/**
 * Probar el borrador del analisis (F26) sin escribir en `calls`.
 *
 * Usa la MISMA `runCallAnalysis` que produccion —mismo armado del prompt, mismo
 * contexto del negocio, misma regla de categorias nuevas— y solo cambia de donde
 * salen las instrucciones y la rubrica (el editor, aunque no se haya guardado).
 * Esta funcion es pura respecto de la base: no lee ni escribe; la accion le pasa
 * las llamadas y registra los runs.
 */
import type { GenerateFn } from "./ai-generate";
import { runCallAnalysis } from "./analyze";
import type { CallAnalysis } from "./analysis-schema";
import { changedCriteria, type CallCategories, type Rubric } from "./rubric";

export const MAX_TEST_CALLS = 5;

export interface TestCallInput {
  id: string;
  title: string;
  call_type: string | null;
  transcript: unknown;
  /** Lo que tiene guardado hoy (puntajes y analisis vigente), para comparar. */
  current: { closer_score: number | null; lead_score: number | null; outcome: string | null; analysis: unknown };
}

export interface TestCallResult {
  callId: string;
  title: string;
  ok: boolean;
  error?: string;
  closer: { current: number | null; draft: number | null };
  lead: { current: number | null; draft: number | null };
  outcome: { current: string | null; draft: string | null; same: boolean };
  changedCriteria: ReturnType<typeof changedCriteria>;
}

export interface TestSetup {
  rubric: Rubric;
  categories: CallCategories;
  allowNewCategories: boolean;
  companyContext: string | null;
  instructions: string;
  generate: GenerateFn;
}

export function validateTestRequest(callIds: string[]): string | null {
  const ids = [...new Set(callIds)];
  if (ids.length === 0) return "Elegí al menos una llamada";
  if (ids.length > MAX_TEST_CALLS) return `Podés probar hasta ${MAX_TEST_CALLS} llamadas a la vez`;
  return null;
}

function emptyResult(call: TestCallInput): Omit<TestCallResult, "ok"> {
  return {
    callId: call.id,
    title: call.title,
    closer: { current: call.current.closer_score, draft: null },
    lead: { current: call.current.lead_score, draft: null },
    outcome: { current: call.current.outcome, draft: null, same: false },
    changedCriteria: [],
  };
}

export async function testOneCall(call: TestCallInput, setup: TestSetup): Promise<TestCallResult> {
  const result = await runCallAnalysis({
    call: { title: call.title, call_type: call.call_type, transcript: call.transcript },
    rubric: setup.rubric,
    categories: setup.categories,
    allowNewCategories: setup.allowNewCategories,
    companyContext: setup.companyContext,
    instructions: setup.instructions,
    generate: setup.generate,
  });
  if (!result.ok) return { ...emptyResult(call), ok: false, error: result.error };
  const draft: CallAnalysis = result.analysis;
  const draftOutcome = draft.resultado.categoria;
  return {
    ...emptyResult(call),
    ok: true,
    closer: { current: call.current.closer_score, draft: result.scores.closer_score },
    lead: { current: call.current.lead_score, draft: result.scores.lead_score },
    outcome: { current: call.current.outcome, draft: draftOutcome, same: call.current.outcome === draftOutcome },
    changedCriteria: changedCriteria(call.current.analysis, draft),
  };
}

/** Prueba las llamadas de a una: el tope de gasto se mira entre una y otra (`beforeEach`). */
export async function testCallAnalysis(
  calls: TestCallInput[],
  setup: TestSetup,
  hooks: {
    beforeEach?: (call: TestCallInput) => Promise<{ allowed: boolean; message?: string }>;
    afterEach?: (call: TestCallInput, result: TestCallResult) => Promise<void>;
  } = {},
): Promise<TestCallResult[]> {
  const out: TestCallResult[] = [];
  for (const call of calls) {
    if (hooks.beforeEach) {
      const gate = await hooks.beforeEach(call);
      if (!gate.allowed) {
        out.push({ ...emptyResult(call), ok: false, error: gate.message ?? "Se alcanzó el tope de gasto de IA" });
        continue;
      }
    }
    const result = await testOneCall(call, setup);
    out.push(result);
    if (hooks.afterEach) await hooks.afterEach(call, result);
  }
  return out;
}
