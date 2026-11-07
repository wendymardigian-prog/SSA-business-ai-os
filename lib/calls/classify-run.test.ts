import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const run = vi.hoisted(() => ({
  setModel: vi.fn(),
  setFinalUsage: vi.fn(),
  step: vi.fn().mockResolvedValue("s"),
  close: vi.fn().mockResolvedValue({ costUsd: 0, pricingMissing: [] }),
  runId: "run-1",
}));
const mocks = vi.hoisted(() => ({
  openAiRun: vi.fn(),
  budget: vi.fn(),
  model: vi.fn(),
  instructions: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/ai/run", () => ({ openAiRun: mocks.openAiRun }));
vi.mock("@/lib/ai/workspace-budget", () => ({ withinWorkspaceBudget: mocks.budget }));
vi.mock("@/lib/ai-tasks/model", () => ({ resolveTaskModel: mocks.model }));
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: mocks.instructions, loadTaskInstructionsForRun: mocks.instructions, workspaceOwnStyle: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ auditAsSystem: mocks.audit }));

import { runCallClassification } from "./classify-run";
import { DEFAULT_CLASSIFICATION, DEFAULT_ANALYSIS } from "./task-settings";

const NOW = new Date("2026-10-10T12:00:00Z");
const VENTAS = "11111111-1111-4111-8111-111111111111";
const CIERRE = "22222222-2222-4222-8222-222222222222";
const SERVICIO = "33333333-3333-4333-8333-333333333333";
const ONBOARDING = "44444444-4444-4444-8444-444444444444";
const EQUIPO = "55555555-5555-4555-8555-555555555555";
const cat = (id: string, parent_id: string | null, name: string, system_key: string | null) => ({ id, parent_id, name, color: null, position: 0, is_system: !!system_key, archived_at: null, system_key, description: null });
const CATEGORIES = [
  cat(VENTAS, null, "Ventas", "ventas"),
  cat(CIERRE, VENTAS, "Cierre", "ventas.cierre"),
  cat(SERVICIO, null, "Servicio", "servicio"),
  cat(ONBOARDING, SERVICIO, "Onboarding", null),
  cat(EQUIPO, null, "Equipo", "equipo"),
];
const SERVICIO_ONBOARDING = { area_id: SERVICIO, area_name: "Servicio", type_id: ONBOARDING, type_name: "Onboarding" };
const transcript = [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "hola" }];
const baseCall = {
  id: "c1",
  workspace_id: "ws1",
  title: "Llamada con un lead",
  duration_seconds: 1800,
  attendees: [{ name: "Ana", email: "ana@lead.com", is_external: true }],
  transcript,
  booking_id: null,
  contact_id: "ct1",
  call_type: null,
  call_type_source: null,
  analysis_status: "classifying",
};

const analyzer = (categoryId: string, mode: "manual" | "auto" = "manual", rules: Record<string, unknown> = {}) => ({
  id: `perfil-${categoryId}`,
  workspace_id: "ws1",
  category_id: categoryId,
  shape: "sales",
  mode,
  rules,
  rubric: null,
  auto_summary: true,
  auto_memory: true,
  auto_knowledge: false,
  active_prompt_version: null,
});

function setup(over: { call?: Record<string, unknown>; settings?: Record<string, unknown>; bookingSnapshot?: unknown; profiles?: unknown[]; connectionSettings?: unknown } = {}) {
  const db = fakeDb(
    {
      "call_analysis_profiles:select": { data: over.profiles ?? [analyzer(CIERRE)] },
      "oauth_connections:select": { data: { fathom_settings: over.connectionSettings ?? {} } },
      "calls:select": { data: { ...baseCall, ...over.call } },
      "calls:update": { data: [{ id: "c1" }] },
      "workspaces:select": { data: { ai_background_settings: over.settings ?? {} } },
      "scheduled_jobs:insert": { data: { id: "j1" } },
      "booking_categories:select": { data: CATEGORIES },
      "bookings:select": { data: { category_snapshot: over.bookingSnapshot ?? null } },
    },
    { workspace_member_profiles: { data: [{ user_id: "u1", email: "yo@agencia.com", full_name: "Carla", meta_name: null }] } },
  );
  return db;
}

const generateOk = (obj: Record<string, unknown>) => vi.fn().mockResolvedValue({ object: obj, usage: { inputTokens: 100, outputTokens: 20 } });
const settingsWith = (c: Record<string, unknown> = {}, a: Record<string, unknown> = {}) => ({
  call_classification: { ...DEFAULT_CLASSIFICATION, mode: "now", ...c },
  call_analysis: { ...DEFAULT_ANALYSIS, ...a },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openAiRun.mockResolvedValue(run);
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.model.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "haiku", chosen: false });
  mocks.instructions.mockResolvedValue({ version: null, text: "Clasificá. Tipos: {{tipos}}" });
});

describe("runCallClassification", () => {
  it("una llamada que no existe o esta archivada no hace nada", async () => {
    const db = fakeDb({ "calls:select": { data: null } });
    expect(await runCallClassification({ db: db.client, now: NOW }, "nope")).toEqual({ outcome: "gone" });
    expect(db.writes()).toHaveLength(0);
  });

  it("un tipo puesto por una persona nunca se pisa", async () => {
    const db = setup({ call: { call_type: "cierre", call_type_source: "human", category_id: CIERRE, area_id: VENTAS } });
    const generate = generateOk({ tipo: "equipo", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("kept_human");
    expect(generate).not.toHaveBeenCalled();
    const update = db.writesTo("calls")[0];
    expect(update.values).not.toHaveProperty("call_type");
    expect(update.values).toMatchObject({ analysis_status: "pending", analysis_status_reason: "manual" });
  });

  it("con un analizador automatico, una llamada nueva se manda a analizar", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }), profiles: [analyzer(CIERRE, "auto")] });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 0.95, motivo: "x" });
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(db.writesTo("scheduled_jobs").some((w) => (w.values as { type: string }).type === "call_analyze")).toBe(true);
  });

  it("una llamada importada del historial se clasifica, pero NO se analiza sola", async () => {
    const db = setup({ call: { imported_from_history: true }, settings: settingsWith({ rules: [] }), profiles: [analyzer(CIERRE, "auto")] });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 0.95, motivo: "x" });
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ call_type: "cierre", analysis_status: "pending", analysis_status_reason: "manual" });
    expect(db.writesTo("scheduled_jobs").some((w) => (w.values as { type: string }).type === "call_analyze")).toBe(false);
  });

  it("tampoco si una persona ya le habia puesto el tipo", async () => {
    const db = setup({ call: { imported_from_history: true, call_type: "cierre", call_type_source: "human", category_id: CIERRE, area_id: VENTAS }, profiles: [analyzer(CIERRE, "auto")] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({}) }, "c1");
    expect(db.writesTo("scheduled_jobs").some((w) => (w.values as { type: string }).type === "call_analyze")).toBe(false);
  });

  it("una llamada agendada de Servicio hereda su area y su tipo, y ya no queda como cierre", async () => {
    const db = setup({ call: { booking_id: "b1" }, bookingSnapshot: SERVICIO_ONBOARDING, settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("booking");
    expect(generate).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({
      area_id: SERVICIO,
      category_id: ONBOARDING,
      category_snapshot: SERVICIO_ONBOARDING,
      classification_source: "booking",
      call_type: "cliente",
      call_type_rule: "reunión vinculada",
    });
  });

  it("una regla no le cambia el area a la reunion: solo completa el tipo dentro de ella", async () => {
    const soloArea = { area_id: SERVICIO, area_name: "Servicio", type_id: null, type_name: null };
    const rule = { id: "x", on: true, cond: "title_contains", value: ["llamada"], type: CIERRE };
    const db = setup({ call: { booking_id: "b1" }, bookingSnapshot: soloArea, settings: settingsWith({ rules: [rule], mode: "off" }) });
    const r = await runCallClassification({ db: db.client, now: NOW }, "c1");
    expect(r.outcome).toBe("booking");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: SERVICIO, category_id: SERVICIO, classification_source: "booking" });
  });

  it("con el area de la reunion, la IA solo elige entre los tipos de esa area", async () => {
    const soloArea = { area_id: SERVICIO, area_name: "Servicio", type_id: null, type_name: null };
    const db = setup({ call: { booking_id: "b1" }, bookingSnapshot: soloArea, settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "Servicio · Onboarding", confianza: 0.9, motivo: "x" });
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(generate.mock.calls[0][0].system).not.toContain("Ventas · Cierre");
    const last = db.writesTo("calls").at(-1)!.values;
    expect(last).toMatchObject({ area_id: SERVICIO, category_id: ONBOARDING, classification_source: "booking" });
  });

  it("si la IA falla, el area que ya se sabia queda guardada", async () => {
    const soloArea = { area_id: SERVICIO, area_name: "Servicio", type_id: null, type_name: null };
    const db = setup({ call: { booking_id: "b1" }, bookingSnapshot: soloArea, settings: settingsWith({ rules: [] }) });
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }));
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 0);
    expect(r.outcome).toBe("retry");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: SERVICIO, classification_source: "booking" });
  });

  it("una opcion que la IA inventa no se guarda: queda sin clasificar", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const r = await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Venta magica", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(r.outcome).toBe("no_decision");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "low_confidence" });
    expect(db.writesTo("calls")[0].values).not.toHaveProperty("area_id");
  });

  it("una regla vieja con la clave de un tipo sigue decidiendo", async () => {
    const rule = { id: "x", on: true, cond: "title_contains", value: ["llamada"], type: "equipo" };
    const db = setup({ settings: settingsWith({ rules: [rule] }) });
    const r = await runCallClassification({ db: db.client, now: NOW, generate: generateOk({}) }, "c1");
    expect(r.outcome).toBe("rule");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: EQUIPO, call_type: "equipo", classification_source: "rule" });
  });

  it("una regla decide sin gastar IA", async () => {
    const db = setup({ call: { duration_seconds: 120 } }); // regla por defecto: menos de 10 min => no_show
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("rule");
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
    const update = db.writesTo("calls")[0].values as Record<string, unknown>;
    expect(update).toMatchObject({ call_type: "no_show", no_show: true, call_type_source: "rule", analysis_status: "not_applicable" });
  });

  it("sin regla y con la IA prendida, clasifica con el modelo y registra el run", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 0.92, motivo: "Hablan de precio" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("ai");
    const update = db.writesTo("calls")[0].values as Record<string, unknown>;
    expect(update).toMatchObject({ area_id: VENTAS, category_id: CIERRE, classification_source: "ai", call_type: "cierre", call_type_source: "ai", call_type_confidence: 0.92, analysis_status: "pending", analysis_status_reason: "manual" });
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "call_classification", trigger: "job", workspaceId: "ws1" });
    expect(run.close).toHaveBeenCalledWith({ status: "responded" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.type_changed", entityId: "c1", label: "Clasificación automática" }));
  });

  it("el area de la conexion decide si la reunion y las reglas no: la IA solo completa el tipo", async () => {
    const db = setup({ call: { connection_id: "conn1" }, connectionSettings: { default_area_id: SERVICIO }, settings: settingsWith({ rules: [] }), profiles: [] });
    const generate = generateOk({ tipo: "Servicio · Onboarding", confianza: 0.9, motivo: "x" });
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(generate.mock.calls[0][0].prompt + generate.mock.calls[0][0].system).not.toContain("Ventas · Cierre");
    expect(db.writesTo("calls").at(-1)!.values).toMatchObject({ area_id: SERVICIO, category_id: ONBOARDING, classification_source: "connection" });
  });

  it("la reunion vinculada le gana al area de la conexion", async () => {
    const db = setup({ call: { booking_id: "b1", connection_id: "conn1" }, bookingSnapshot: { area_id: EQUIPO, area_name: "Equipo", type_id: null, type_name: null }, connectionSettings: { default_area_id: SERVICIO }, settings: settingsWith({ rules: [] }) });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({}) }, "c1");
    expect(db.writesTo("calls").at(-1)!.values).toMatchObject({ area_id: EQUIPO, classification_source: "booking" });
  });

  it("un area de conexion que ya no existe no decide", async () => {
    const db = setup({ call: { connection_id: "conn1" }, connectionSettings: { default_area_id: "99999999-9999-4999-8999-999999999999" }, settings: settingsWith({ rules: [] }) });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(db.writesTo("calls").at(-1)!.values).toMatchObject({ area_id: VENTAS, classification_source: "ai" });
  });

  it("lo importado sin el pedido de usar IA no llama al modelo: queda Sin clasificar y lo dice", async () => {
    const db = setup({ call: { imported_from_history: true }, settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 0, { noAi: true });
    expect(r.outcome).toBe("no_decision");
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "imported_no_ai" });
  });

  it("sin IA, el area de la conexion igual clasifica lo importado", async () => {
    const db = setup({ call: { imported_from_history: true, connection_id: "conn1" }, connectionSettings: { default_area_id: EQUIPO }, settings: settingsWith({ rules: [] }), profiles: [] });
    const generate = generateOk({});
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 0, { noAi: true });
    expect(generate).not.toHaveBeenCalled();
    expect(db.writesTo("calls").at(-1)!.values).toMatchObject({ area_id: EQUIPO, classification_source: "connection" });
  });

  it("un tipo sin analizador queda en No aplica, sin encolar ni gastar", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }), profiles: [] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "not_applicable", analysis_status_reason: "no_profile" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("sin analizador propio, usa el de su area", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }), profiles: [analyzer(VENTAS, "auto")] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(db.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_analyze" });
  });

  it("un analizador automatico respeta sus reglas: lo que no cumple queda pendiente", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }), profiles: [analyzer(CIERRE, "auto", { title_contains: ["demo"] })] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "pending", analysis_status_reason: "rules" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("el analizador de Ventas no alcanza a una reunion de Servicio", async () => {
    const db = setup({ call: { booking_id: "b1" }, bookingSnapshot: SERVICIO_ONBOARDING, settings: settingsWith({ rules: [] }), profiles: [analyzer(VENTAS, "auto"), analyzer(CIERRE, "auto")] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({}) }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ area_id: SERVICIO, analysis_status: "not_applicable", analysis_status_reason: "no_profile" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("con un analizador automatico, encola el analisis de un cierre", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }), profiles: [analyzer(CIERRE, "auto")] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    const job = db.writesTo("scheduled_jobs")[0];
    expect(job.values).toMatchObject({ type: "call_analyze", dedupe_key: "call_analyze:c1" });
    expect((db.writesTo("calls")[0].values as Record<string, unknown>).analysis_status_reason).toBeNull();
  });

  it("confianza bajo el umbral: queda por revisar y no se encola nada", async () => {
    const db = setup({ settings: settingsWith({ rules: [], confidence_threshold: 0.8 }), profiles: [analyzer(CIERRE, "auto")] });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.4, motivo: "dudoso" }) }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "low_confidence" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("con la clasificacion con IA apagada y sin regla, queda por revisar sin llamar al modelo", async () => {
    const db = setup({ settings: settingsWith({ rules: [], mode: "off" }) });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("no_decision");
    expect(generate).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "ai_off" });
  });

  it("sin transcripcion no se gasta IA: por revisar con ese motivo", async () => {
    const db = setup({ call: { transcript: [] }, settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "Ventas · Cierre", confianza: 1, motivo: "x" });
    await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(generate).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "no_transcript" });
  });

  it("frenada por el tope de gasto: por revisar con motivo budget, sin abrir run", async () => {
    mocks.budget.mockResolvedValue({ allowed: false, message: "tope" });
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const r = await runCallClassification({ db: db.client, now: NOW, generate: generateOk({}) }, "c1");
    expect(r.outcome).toBe("budget");
    expect(mocks.openAiRun).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "budget" });
  });

  it("un 429 reagenda el job a 1 minuto con el contador de reintentos, sin tocar la llamada", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }));
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 0);
    expect(r.outcome).toBe("retry");
    expect(run.close).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    const job = db.writesTo("scheduled_jobs")[0].values as { run_at: string; payload: Record<string, unknown> };
    expect(job.run_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(job.payload).toMatchObject({ callId: "c1", retry: 1 });
    expect(db.writesTo("calls")).toHaveLength(0);
  });

  it("agotados los reintentos, la llamada queda por revisar con el motivo ai_error", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }));
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 3);
    expect(r.outcome).toBe("failed");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "ai_error" });
  });

  it("una key invalida (401) no se reintenta", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("invalid x-api-key"), { statusCode: 401 }));
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1", 0);
    expect(r.outcome).toBe("failed");
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("una respuesta que no cumple el esquema queda por revisar con ese motivo, sin reintentar", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const err = Object.assign(new Error("No object generated"), { name: "AI_NoObjectGeneratedError" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate: vi.fn().mockRejectedValue(err) }, "c1");
    expect(r.outcome).toBe("failed");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "schema" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("el run queda atado a la llamada (threadId)", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "Ventas · Cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ threadId: "c1" });
  });

  it("sin proveedor de IA conectado queda por revisar, no explota", async () => {
    mocks.model.mockResolvedValue({ ok: false, model: null, message: "No hay un proveedor de IA conectado", chosen: false });
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const r = await runCallClassification({ db: db.client, now: NOW }, "c1");
    expect(r.outcome).toBe("failed");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status_reason: "ai_error" });
  });
});
