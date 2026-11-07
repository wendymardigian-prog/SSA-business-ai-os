import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), service: vi.fn(), budget: vi.fn(), model: vi.fn(), instructions: vi.fn(), openAiRun: vi.fn(), generate: vi.fn() }));
const run = vi.hoisted(() => ({ setModel: vi.fn(), setFinalUsage: vi.fn(), step: vi.fn(), close: vi.fn().mockResolvedValue({ costUsd: 0, pricingMissing: [] }), runId: "r" }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.service }));
vi.mock("@/lib/ai/run", () => ({ openAiRun: mocks.openAiRun }));
vi.mock("@/lib/ai/workspace-budget", () => ({ withinWorkspaceBudget: mocks.budget }));
vi.mock("@/lib/ai-tasks/model", () => ({ resolveTaskModel: mocks.model }));
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: mocks.instructions, workspaceOwnStyle: vi.fn() }));
vi.mock("@/lib/calls/ai-generate", () => ({ aiSdkGenerate: () => mocks.generate }));

import { testCallDraft } from "./calls-test";
import { DEFAULT_ANALYSIS } from "@/lib/calls/task-settings";
import { DEFAULT_GENERAL_RUBRIC } from "@/lib/calls/profiles";
import { DEFAULT_RUBRIC } from "@/lib/calls/rubric";

const CATEGORY = "33333333-3333-4333-8333-333333333333";
const draft = (over: Record<string, unknown> = {}) => ({ categoryId: CATEGORY, shape: "sales" as const, rubricDraft: DEFAULT_RUBRIC, callIds: [A], ...over });
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const keys = DEFAULT_RUBRIC.closer.map((c) => c.clave);
const analysis = (p = 4) => ({
  resultado: { categoria: "venta" },
  resumen: "r",
  rubrica: keys.map((k) => ({ codigo: k, nombre: k, puntaje: p, justificacion: "j" })),
  lead: { perfil: "p", creencias: DEFAULT_RUBRIC.lead.map((l) => ({ codigo: l.clave, nombre: l.nombre, estado: "Firme" })) },
  feedback: { foco: "f", funciono: [], mejorar: [] },
});
const callRow = (id: string) => ({ id, title: `Llamada ${id.slice(0, 2)}`, category_snapshot: { area_id: "area-ventas", area_name: "Ventas", type_id: "tipo-cierre", type_name: "Cierre" }, transcript: [{ timestamp: "0", speaker: { display_name: "A" }, text: "hola" }], closer_score: 40, lead_score: 50, outcome: "venta", analysis: analysis(2) });

let user: ReturnType<typeof fakeDb>;
let service: ReturnType<typeof fakeDb>;
function setup(rows = [callRow(A)], granted: string[] = ["calls.configure"]) {
  user = fakeDb({ "calls:select": { data: rows } });
  service = fakeDb({ "workspaces:select": { data: { ai_background_settings: { call_analysis: DEFAULT_ANALYSIS } } } });
  mocks.permission.mockImplementation(async (key: string) => (granted.includes(key) ? { workspace: { id: "ws1" }, user: { id: "u1" }, supabase: user.client } : null));
  mocks.service.mockResolvedValue(service.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.model.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "sonnet" });
  mocks.instructions.mockResolvedValue({ version: 2, text: "Instrucciones activas" });
  mocks.openAiRun.mockResolvedValue(run);
  mocks.generate.mockResolvedValue({ object: analysis(5), usage: { inputTokens: 5 } });
});

describe("testCallDraft: permisos y limites", () => {
  it("sin permiso de configurar no hace nada", async () => {
    setup([callRow(A)], ["agents.edit"]);
    expect((await testCallDraft(draft())).ok).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("pide de 1 a 5 grabaciones, ids validos y un tipo", async () => {
    setup();
    expect((await testCallDraft(draft({ callIds: [] }))).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`);
    expect((await testCallDraft(draft({ callIds: six }))).ok).toBe(false);
    expect((await testCallDraft(draft({ callIds: ["no-es-uuid"] }))).ok).toBe(false);
    expect((await testCallDraft(draft({ categoryId: "no-es-uuid" }))).ok).toBe(false);
    expect((await testCallDraft(draft({ shape: "raro" }))).ok).toBe(false);
  });
  it("lee con el cliente de la persona, y no hace falta que ya este analizada", async () => {
    setup();
    await testCallDraft(draft());
    const columns = user.calls[0].filters.map((f) => f.column);
    expect(columns).toContain("workspace_id");
    expect(columns).not.toContain("analysis_status");
  });
  it("si ninguna se ve o tiene transcripcion, lo dice", async () => {
    setup([]);
    expect(await testCallDraft(draft())).toEqual({ ok: false, error: "No encontré grabaciones con transcripción para probar" });
    setup([{ ...callRow(A), transcript: [] as never }]);
    expect((await testCallDraft(draft())).ok).toBe(false);
  });
});

describe("testCallDraft: lo que prueba y lo que NO escribe", () => {
  it("usa el texto del editor aunque no este guardado, y las de respaldo si no hay texto", async () => {
    setup();
    await testCallDraft(draft({ instructionsText: "TEXTO DEL EDITOR" }));
    expect(mocks.generate.mock.calls[0][0].system).toContain("TEXTO DEL EDITOR");
    expect(mocks.instructions).not.toHaveBeenCalled();
    setup();
    await testCallDraft(draft());
    expect(mocks.generate.mock.calls.at(-1)![0].system).toContain("Instrucciones activas");
  });

  it("devuelve la comparacion por grabacion", async () => {
    setup();
    const r = await testCallDraft(draft());
    expect(r.ok && r.results[0]).toMatchObject({ callId: A, closer: { current: 40, draft: 100 }, outcome: { same: true } });
  });

  it("el formato general no pide datos de venta ni tiene lead", async () => {
    setup();
    mocks.generate.mockResolvedValue({ object: { resumen: "r", rubrica: [{ codigo: "escucha", nombre: "Escucha", puntaje: 5, justificacion: "j" }], feedback: { foco: "f", funciono: [], mejorar: [] } }, usage: {} });
    const r = await testCallDraft(draft({ shape: "general", rubricDraft: DEFAULT_GENERAL_RUBRIC, instructionsText: "Mirá el servicio." }));
    expect(r.ok && r.results[0]).toMatchObject({ ok: true, lead: { draft: null }, outcome: { draft: null } });
    expect(mocks.generate.mock.calls[0][0].system).not.toContain("creencia");
  });

  it("NO escribe nada: ni en calls, ni en versiones, ni en workspaces (solo los runs)", async () => {
    setup([callRow(A), callRow(B)]);
    await testCallDraft(draft({ callIds: [A, B], instructionsText: "borrador" }));
    expect(user.writes()).toHaveLength(0);
    expect(service.writes()).toHaveLength(0);
    expect(service.rpcCalls).toHaveLength(0);
  });

  it("registra un run por grabacion con source call_prompt_test, y el costo se cierra en cada una", async () => {
    setup([callRow(A), callRow(B)]);
    await testCallDraft(draft({ callIds: [A, B] }));
    expect(mocks.openAiRun).toHaveBeenCalledTimes(2);
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "call_prompt_test", trigger: "manual" });
    expect(run.close).toHaveBeenCalledTimes(2);
    expect(run.setFinalUsage).toHaveBeenCalledWith({ inputTokens: 5 });
  });

  it("una rubrica del editor que no suma 100 se rechaza antes de gastar IA", async () => {
    setup();
    const bad = structuredClone(DEFAULT_RUBRIC);
    bad.closer[0].peso += 10;
    const r = await testCallDraft(draft({ rubricDraft: bad }));
    expect(r.ok).toBe(false);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("con el tope alcanzado ninguna grabacion llama al modelo", async () => {
    setup();
    mocks.budget.mockResolvedValue({ allowed: false, message: "Tope" });
    const r = await testCallDraft(draft());
    expect(r.ok && r.results[0]).toMatchObject({ ok: false, error: "Tope" });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
  });

  it("instrucciones gigantes se rechazan", async () => {
    setup();
    expect((await testCallDraft(draft({ instructionsText: "x".repeat(32_001) }))).ok).toBe(false);
  });
});
