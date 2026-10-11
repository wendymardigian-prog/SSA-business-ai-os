import { describe, expect, it, vi } from "vitest";
import { buildAnalysisSystem } from "./analyze";
import { MAX_TEST_CALLS, testCallAnalysis, validateTestRequest, type TestCallInput, type TestSetup } from "./prompt-test";
import { DEFAULT_RUBRIC, EMPTY_CATEGORIES } from "./rubric";

const keys = DEFAULT_RUBRIC.closer.map((c) => c.clave);
const analysis = (puntaje: number, categoria = "venta") => ({
  resultado: { categoria },
  resumen: "r",
  rubrica: keys.map((k) => ({ codigo: k, nombre: k, puntaje, justificacion: "j" })),
  lead: { perfil: "p", creencias: DEFAULT_RUBRIC.lead.map((l) => ({ codigo: l.clave, nombre: l.nombre, estado: "Firme" })) },
  feedback: { foco: "f", funciono: [], mejorar: [] },
});
const call = (id: string, over: Partial<TestCallInput["current"]> = {}): TestCallInput => ({
  id,
  title: `Llamada ${id}`,
  call_type: "cierre",
  transcript: [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }],
  current: { closer_score: 50, lead_score: 60, outcome: "venta", analysis: analysis(3), ...over },
});
const setup = (generate: TestSetup["generate"], over: Partial<TestSetup> = {}): TestSetup => ({
  rubric: DEFAULT_RUBRIC,
  categories: EMPTY_CATEGORIES,
  allowNewCategories: true,
  companyContext: "Agencia",
  instructions: "Analizá {{estilo}}",
  generate,
  ...over,
});

describe("validateTestRequest", () => {
  it("de 1 a 5 llamadas", () => {
    expect(validateTestRequest([])).toBeTruthy();
    expect(validateTestRequest(["a"])).toBeNull();
    expect(validateTestRequest(["1", "2", "3", "4", "5"])).toBeNull();
    expect(validateTestRequest(["1", "2", "3", "4", "5", "6"])).toContain(String(MAX_TEST_CALLS));
  });
  it("los repetidos no cuentan dos veces", () => {
    expect(validateTestRequest(["a", "a", "a", "a", "a", "a"])).toBeNull();
  });
});

describe("testCallAnalysis", () => {
  it("compara lo actual con el borrador: puntajes, resultado y criterios que cambiaron", async () => {
    const generate = vi.fn().mockResolvedValue({ object: analysis(5, "no_venta") });
    const [r] = await testCallAnalysis([call("a")], setup(generate));
    expect(r).toMatchObject({ ok: true, callId: "a", closer: { current: 50, draft: 100 }, lead: { current: 60, draft: 100 }, outcome: { current: "venta", draft: "no_venta", same: false } });
    expect(r.changedCriteria.length).toBe(keys.length);
    expect(r.changedCriteria[0]).toMatchObject({ antes: 3, despues: 5 });
  });

  it("'igual' cuando el resultado no cambia y ningun criterio cambio", async () => {
    const [r] = await testCallAnalysis([call("a")], setup(vi.fn().mockResolvedValue({ object: analysis(3) })));
    expect(r.outcome.same).toBe(true);
    expect(r.changedCriteria).toEqual([]);
  });

  it("el sistema que se manda es IDENTICO al de produccion para el mismo texto, rubrica y llamada", async () => {
    const generate = vi.fn().mockResolvedValue({ object: analysis(3) });
    await testCallAnalysis([call("a")], setup(generate));
    const sent = generate.mock.calls[0][0].system;
    const prod = buildAnalysisSystem({ instructions: "Analizá {{estilo}}", rubric: DEFAULT_RUBRIC, categories: EMPTY_CATEGORIES, allowNewCategories: true, companyContext: "Agencia", callType: "cierre" });
    expect(sent).toBe(prod);
  });

  it("usa el texto y la rubrica DEL EDITOR, no los guardados", async () => {
    const generate = vi.fn().mockResolvedValue({ object: analysis(3) });
    await testCallAnalysis([call("a")], setup(generate, { instructions: "TEXTO BORRADOR UNICO" }));
    expect(generate.mock.calls[0][0].system).toContain("TEXTO BORRADOR UNICO");
  });

  it("una falla de una llamada no frena a las demas", async () => {
    const generate = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue({ object: analysis(3) });
    const out = await testCallAnalysis([call("a"), call("b")], setup(generate));
    expect(out.map((r) => r.ok)).toEqual([false, true]);
    expect(out[0].error).toBe("429");
  });

  it("el tope de gasto se mira antes de CADA llamada y frena el resto sin llamar al modelo", async () => {
    const generate = vi.fn().mockResolvedValue({ object: analysis(3) });
    const gate = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, message: "Tope alcanzado" });
    const out = await testCallAnalysis([call("a"), call("b"), call("c")], setup(generate), { beforeEach: gate });
    expect(gate).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.map((r) => r.ok)).toEqual([true, false, false]);
    expect(out[1].error).toBe("Tope alcanzado");
  });

  it("avisa despues de cada llamada (para registrar el run)", async () => {
    const after = vi.fn().mockResolvedValue(undefined);
    await testCallAnalysis([call("a"), call("b")], setup(vi.fn().mockResolvedValue({ object: analysis(3) })), { afterEach: after });
    expect(after).toHaveBeenCalledTimes(2);
  });
});
