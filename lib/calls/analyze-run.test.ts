import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const run = vi.hoisted(() => ({
  setModel: vi.fn(),
  setFinalUsage: vi.fn(),
  step: vi.fn().mockResolvedValue("s"),
  close: vi.fn().mockResolvedValue({ costUsd: 0.0123, pricingMissing: [] }),
  runId: "11111111-1111-4111-8111-111111111111" as string | null,
}));
const mocks = vi.hoisted(() => ({
  openAiRun: vi.fn(),
  budget: vi.fn(),
  model: vi.fn(),
  instructions: vi.fn(),
  audit: vi.fn(),
  logAudit: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/ai/run", () => ({ openAiRun: mocks.openAiRun }));
vi.mock("@/lib/ai/workspace-budget", () => ({ withinWorkspaceBudget: mocks.budget }));
vi.mock("@/lib/ai-tasks/model", () => ({ resolveTaskModel: mocks.model }));
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: mocks.instructions }));
vi.mock("@/lib/audit", () => ({ auditAsSystem: mocks.audit, logAudit: mocks.logAudit }));
vi.mock("./notify", () => ({ notifyBudgetBlocked: mocks.notify }));

import { registerJobHandler } from "@/lib/jobs/registry";
import { runCallAnalysisJob } from "./analyze-run";
import { TruncatedOutputError } from "./ai-generate";
import { DEFAULT_RUBRIC } from "./rubric";
import { DEFAULT_ANALYSIS } from "./task-settings";

const NOW = new Date("2026-10-10T12:00:00Z");
const transcript = [{ timestamp: "00:01", speaker: { display_name: "Ana" }, text: "no me llegan clientes" }];
const callRow = {
  id: "c1",
  workspace_id: "ws1",
  title: "Llamada",
  call_type: "cierre",
  transcript,
  contact_id: "ct1",
  analysis_status: "pending",
  closer_score: null,
  lead_score: null,
};
const closerKeys = DEFAULT_RUBRIC.closer.map((c) => c.clave);
const analysis = () => ({
  resultado: { categoria: "venta", fecha: "2026-10-20" },
  resumen: "ok",
  objecion: { dijo: "caro", categoria: "precio", cita: "no me llegan clientes" },
  rubrica: closerKeys.map((k) => ({ codigo: k, nombre: k, puntaje: 5, justificacion: "ok", cita: "no me llegan clientes" })),
  lead: { perfil: "p", creencias: DEFAULT_RUBRIC.lead.map((l) => ({ codigo: l.clave, nombre: l.nombre, estado: "Firme" })) },
  feedback: { foco: "f", funciono: [], mejorar: [] },
});

function setup(over: { call?: Record<string, unknown>; claimed?: unknown[] } = {}) {
  return fakeDb({
    "calls:select": { data: { ...callRow, ...over.call } },
    "calls:update": { data: over.claimed ?? [{ id: "c1" }] },
    "workspaces:select": { data: { ai_background_settings: { call_analysis: DEFAULT_ANALYSIS } } },
    "scheduled_jobs:insert": { data: { id: "j1" } },
  });
}
const ok = () => vi.fn().mockResolvedValue({ object: analysis(), usage: { inputTokens: 100, outputTokens: 50 } });
const deps = (db: ReturnType<typeof setup>, generate = ok()) => ({ db: db.client, now: NOW, generate });
const statusUpdates = (db: ReturnType<typeof setup>) => db.writesTo("calls").map((c) => c.values as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  run.runId = "11111111-1111-4111-8111-111111111111";
  mocks.openAiRun.mockResolvedValue(run);
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.model.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "sonnet", chosen: false });
  mocks.instructions.mockResolvedValue({ version: 1, text: "Analizá" });
});

describe("runCallAnalysisJob", () => {
  it("no hace nada con una llamada que no existe", async () => {
    const db = fakeDb({ "calls:select": { data: null } });
    expect(await runCallAnalysisJob({ db: db.client, now: NOW }, { callId: "x" })).toEqual({ outcome: "gone" });
  });

  it("sin transcripcion no gasta IA: por revisar", async () => {
    const db = setup({ call: { transcript: [] } });
    const r = await runCallAnalysisJob(deps(db), { callId: "c1" });
    expect(r.outcome).toBe("no_transcript");
    expect(statusUpdates(db)[0]).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "no_transcript" });
    expect(mocks.openAiRun).not.toHaveBeenCalled();
  });

  it("con el tope alcanzado queda pendiente por presupuesto y avisa", async () => {
    mocks.budget.mockResolvedValue({ allowed: false });
    const db = setup();
    const r = await runCallAnalysisJob(deps(db), { callId: "c1" });
    expect(r.outcome).toBe("budget");
    expect(statusUpdates(db)[0]).toMatchObject({ analysis_status: "pending", analysis_status_reason: "budget" });
    expect(mocks.notify).toHaveBeenCalledWith(db.client, "ws1", "c1");
    expect(mocks.openAiRun).not.toHaveBeenCalled();
  });

  it("si otro proceso ya la tomo (el claim no devuelve fila), no analiza", async () => {
    const db = setup({ claimed: [] });
    const generate = ok();
    const r = await runCallAnalysisJob(deps(db, generate), { callId: "c1" });
    expect(r.outcome).toBe("not_claimable");
    expect(generate).not.toHaveBeenCalled();
  });

  it("el claim automatico solo toma llamadas pendientes; el manual, tambien las analizadas y las que dieron error", async () => {
    const auto = setup();
    await runCallAnalysisJob(deps(auto), { callId: "c1" });
    const claimAuto = auto.writesTo("calls")[0].filters.find((f) => f.method === "in");
    expect(claimAuto?.value).toEqual(["pending"]);

    const manual = setup();
    await runCallAnalysisJob(deps(manual), { callId: "c1", manual: true, requestedBy: "u1" });
    const claimManual = manual.writesTo("calls")[0].filters.find((f) => f.method === "in");
    expect(claimManual?.value).toEqual(expect.arrayContaining(["pending", "error", "needs_review", "analyzed"]));
  });

  it("guarda el analisis: lo de la IA, la rubrica usada, las versiones y un run nuevo", async () => {
    const db = setup();
    const r = await runCallAnalysisJob(deps(db), { callId: "c1" });
    expect(r.outcome).toBe("analyzed");
    const final = statusUpdates(db).at(-1)!;
    expect(final).toMatchObject({
      analysis_status: "analyzed",
      closer_score: 100,
      lead_score: 100,
      lead_qualification: "calificado",
      outcome: "venta",
      main_objection: "precio",
      analysis_prompt_version: 1,
      rubric_version: DEFAULT_ANALYSIS.rubric.version,
      analysis_model: "anthropic/sonnet",
      analysis_run_id: "11111111-1111-4111-8111-111111111111",
      analysis_edited: false,
      analysis_error: null,
    });
    expect(final.analysis_ai).toEqual(final.analysis);
    expect(final.rubric_snapshot).toEqual(DEFAULT_ANALYSIS.rubric);
    expect(final.quotes_total).toBeGreaterThan(0);
    expect(final.quotes_verified).toBe(final.quotes_total);
    expect(String(final.followup_at)).toContain("2026-10-20");
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "call_analysis", trigger: "job", promptVersion: 1 });
  });

  it("sin run registrado igual escribe un analysis_run_id nuevo (el trigger de la base lo exige)", async () => {
    run.runId = null;
    const db = setup();
    await runCallAnalysisJob(deps(db), { callId: "c1" });
    expect(statusUpdates(db).at(-1)!.analysis_run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("audita como Analisis automatico si lo disparo el sistema, y a nombre de la persona si lo pidio ella", async () => {
    await runCallAnalysisJob(deps(setup()), { callId: "c1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.analyzed", label: "Análisis automático", entityId: "c1" }));
    expect(mocks.logAudit).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.openAiRun.mockResolvedValue(run);
    mocks.budget.mockResolvedValue({ allowed: true });
    mocks.model.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "sonnet", chosen: false });
    mocks.instructions.mockResolvedValue({ version: null, text: "x" });
    await runCallAnalysisJob(deps(setup()), { callId: "c1", manual: true, requestedBy: "u9" });
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ performedBy: "u9", action: "call.analyzed" }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("regenerar con motivo: pasa el contexto como dato; la foto del anterior la guarda la accion, el job audita call.analyzed con el motivo", async () => {
    const generate = ok();
    const db = setup();
    await runCallAnalysisJob(deps(db, generate), { callId: "c1", manual: true, requestedBy: "u1", reason: "falta_contexto", extraContext: "Era un reagendo" });
    expect(generate.mock.calls[0][0].prompt).toContain("Era un reagendo");
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.analyzed", metadata: expect.objectContaining({ reason: "falta_contexto" }) }));
  });

  it("encola el resumen solo si hay quien lo ejecute (y lo deja marcado pendiente)", async () => {
    const without = setup();
    await runCallAnalysisJob(deps(without), { callId: "c1" });
    expect(without.writesTo("scheduled_jobs")).toHaveLength(0);
    expect(statusUpdates(without).at(-1)).not.toHaveProperty("summary_status");

    registerJobHandler("call_summary", async () => undefined);
    const withHandler = setup();
    await runCallAnalysisJob(deps(withHandler), { callId: "c1" });
    expect(withHandler.writesTo("scheduled_jobs")[0].values).toMatchObject({ type: "call_summary", dedupe_key: "call_summary:c1" });
    expect(statusUpdates(withHandler).at(-1)).toMatchObject({ summary_status: "pending" });
  });

  it("una respuesta cortada por largo es un error definitivo, sin reintento", async () => {
    const db = setup();
    const r = await runCallAnalysisJob(deps(db, vi.fn().mockRejectedValue(new TruncatedOutputError())), { callId: "c1" });
    expect(r.outcome).toBe("error");
    expect(statusUpdates(db).at(-1)).toMatchObject({ analysis_status: "error" });
    expect(String(statusUpdates(db).at(-1)!.analysis_error)).toContain("respuesta_cortada");
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
    expect(run.close).toHaveBeenCalledWith(expect.objectContaining({ status: "error", statusDetail: "truncated" }));
  });

  it("un objeto que no cumple el esquema deja la llamada por revisar", async () => {
    const err = Object.assign(new Error("invalid"), { name: "AI_NoObjectGeneratedError" });
    const db = setup();
    const r = await runCallAnalysisJob(deps(db, vi.fn().mockRejectedValue(err)), { callId: "c1" });
    expect(r.outcome).toBe("needs_review");
    expect(statusUpdates(db).at(-1)).toMatchObject({ analysis_status: "needs_review", analysis_status_reason: "schema" });
  });

  it("un 429 reagenda con el contador y conserva si lo pidio una persona; la llamada vuelve a pendiente", async () => {
    const db = setup();
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("rate"), { statusCode: 429 }));
    const r = await runCallAnalysisJob(deps(db, generate), { callId: "c1", manual: true, requestedBy: "u1" }, );
    expect(r.outcome).toBe("retry");
    const job = db.writesTo("scheduled_jobs")[0].values as { run_at: string; payload: Record<string, unknown> };
    expect(job.run_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(job.payload).toMatchObject({ callId: "c1", retry: 1, manual: true, requestedBy: "u1" });
    expect(statusUpdates(db).at(-1)).toMatchObject({ analysis_status: "pending" });
  });

  it("una key invalida (401) deja la llamada en error sin reintentar", async () => {
    const db = setup();
    const generate = vi.fn().mockRejectedValue(Object.assign(new Error("invalid key"), { statusCode: 401 }));
    const r = await runCallAnalysisJob(deps(db, generate), { callId: "c1" });
    expect(r.outcome).toBe("error");
    expect(db.writesTo("scheduled_jobs")).toHaveLength(0);
  });

  it("sin proveedor de IA conectado, la llamada queda en error con un mensaje claro", async () => {
    mocks.model.mockResolvedValue({ ok: false, model: null, message: "No hay un proveedor de IA conectado", chosen: false });
    const db = setup();
    const r = await runCallAnalysisJob({ db: db.client, now: NOW }, { callId: "c1" });
    expect(r.outcome).toBe("error");
    expect(statusUpdates(db).at(-1)).toMatchObject({ analysis_status: "error", analysis_error: "No hay un proveedor de IA conectado" });
  });
});
