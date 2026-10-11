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
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: mocks.instructions }));
vi.mock("@/lib/audit", () => ({ auditAsSystem: mocks.audit }));

import { runCallClassification } from "./classify-run";
import { DEFAULT_CLASSIFICATION, DEFAULT_ANALYSIS } from "./task-settings";

const NOW = new Date("2026-10-10T12:00:00Z");
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

function setup(over: { call?: Record<string, unknown>; settings?: Record<string, unknown> } = {}) {
  const db = fakeDb(
    {
      "calls:select": { data: { ...baseCall, ...over.call } },
      "calls:update": { data: [{ id: "c1" }] },
      "workspaces:select": { data: { ai_background_settings: over.settings ?? {} } },
      "scheduled_jobs:insert": { data: { id: "j1" } },
    },
    { workspace_member_profiles: { data: [{ user_id: "u1", email: "yo@agencia.com", full_name: "Wendy", meta_name: null }] } },
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
    const db = setup({ call: { call_type: "cierre", call_type_source: "human" } });
    const generate = generateOk({ tipo: "equipo", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("kept_human");
    expect(generate).not.toHaveBeenCalled();
    const update = db.writesTo("calls")[0];
    expect(update.values).not.toHaveProperty("call_type");
    expect(update.values).toMatchObject({ analysis_status: "pending", analysis_status_reason: "manual" });
  });

  it("una regla decide sin gastar IA", async () => {
    const db = setup({ call: { duration_seconds: 120 } }); // regla por defecto: menos de 10 min => no_show
    const generate = generateOk({ tipo: "cierre", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("rule");
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
    const update = db.writesTo("calls")[0].values as Record<string, unknown>;
    expect(update).toMatchObject({ call_type: "no_show", call_type_source: "rule", analysis_status: "not_applicable" });
  });

  it("sin regla y con la IA prendida, clasifica con el modelo y registra el run", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "cierre", confianza: 0.92, motivo: "Hablan de precio" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("ai");
    const update = db.writesTo("calls")[0].values as Record<string, unknown>;
    expect(update).toMatchObject({ call_type: "cierre", call_type_source: "ai", call_type_confidence: 0.92, analysis_status: "pending", analysis_status_reason: "manual" });
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "call_classification", trigger: "job", workspaceId: "ws1" });
    expect(run.close).toHaveBeenCalledWith({ status: "responded" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.type_changed", entityId: "c1", label: "Clasificación automática" }));
  });

  it("con el analisis automatico prendido, encola el analisis de un cierre", async () => {
    const db = setup({ settings: settingsWith({ rules: [] }, { mode: "now" }) });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "cierre", confianza: 0.9, motivo: "x" }) }, "c1");
    const job = db.writesTo("scheduled_jobs")[0];
    expect(job.values).toMatchObject({ type: "call_analyze", dedupe_key: "call_analyze:c1" });
    expect((db.writesTo("calls")[0].values as Record<string, unknown>).analysis_status_reason).toBeNull();
  });

  it("confianza bajo el umbral: queda por revisar y no se encola nada", async () => {
    const db = setup({ settings: settingsWith({ rules: [], confidence_threshold: 0.8 }, { mode: "now" }) });
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "cierre", confianza: 0.4, motivo: "dudoso" }) }, "c1");
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "low_confidence" });
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("con la clasificacion con IA apagada y sin regla, queda por revisar sin llamar al modelo", async () => {
    const db = setup({ settings: settingsWith({ rules: [], mode: "off" }) });
    const generate = generateOk({ tipo: "cierre", confianza: 1, motivo: "x" });
    const r = await runCallClassification({ db: db.client, now: NOW, generate }, "c1");
    expect(r.outcome).toBe("no_decision");
    expect(generate).not.toHaveBeenCalled();
    expect(db.writesTo("calls")[0].values).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "ai_off" });
  });

  it("sin transcripcion no se gasta IA: por revisar con ese motivo", async () => {
    const db = setup({ call: { transcript: [] }, settings: settingsWith({ rules: [] }) });
    const generate = generateOk({ tipo: "cierre", confianza: 1, motivo: "x" });
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
    await runCallClassification({ db: db.client, now: NOW, generate: generateOk({ tipo: "cierre", confianza: 0.9, motivo: "x" }) }, "c1");
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
