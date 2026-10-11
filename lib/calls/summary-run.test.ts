import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";

const run = vi.hoisted(() => ({
  setModel: vi.fn(),
  addStepUsage: vi.fn(),
  step: vi.fn().mockResolvedValue("s"),
  close: vi.fn().mockResolvedValue({ costUsd: 0, pricingMissing: [] }),
  runId: "run-1",
}));
const mocks = vi.hoisted(() => ({ openAiRun: vi.fn(), budget: vi.fn(), model: vi.fn(), instructions: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ openAiRun: mocks.openAiRun }));
vi.mock("@/lib/ai/workspace-budget", () => ({ withinWorkspaceBudget: mocks.budget }));
vi.mock("@/lib/ai-tasks/model", () => ({ resolveTaskModel: mocks.model }));
vi.mock("@/lib/ai-tasks/store", () => ({ loadTaskInstructions: mocks.instructions }));
vi.mock("@/lib/audit", () => ({ auditAsSystem: mocks.audit }));

import { runCallSummaryJob } from "./summary-run";

const NOW = new Date("2026-10-10T12:00:00Z");
const transcript = [{ timestamp: "0", speaker: { display_name: "Ana" }, text: "no me llegan clientes" }];
const callRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  workspace_id: "ws1",
  title: "Llamada con Ana",
  call_type: "cierre",
  recorded_at: "2026-10-09T15:00:00Z",
  attendees: [],
  transcript,
  contact_id: "ct1",
  ideas_created_at: null,
  ...over,
});
const summary = (over: Record<string, unknown> = {}) => ({
  resumen: "Resumen",
  proximos_pasos: "Llamar",
  puntos_clave: ["a"],
  sentimiento: "neutral",
  ideas: [
    { gancho: "Idea 1", angulo: "A1", formato: "reel", cita: "no me llegan clientes" },
    { gancho: "Idea 2", angulo: "A2", formato: "post" },
    { gancho: "Idea 3", angulo: "A3", formato: "video" },
  ],
  memoria: "Memoria integrada",
  ...over,
});

interface Contact { memory: string | null; updatedAt: string | null }
function setup(over: { call?: Record<string, unknown> | null; contact?: Contact | null; ideasLast?: number | null } = {}) {
  const contact: Contact | null = over.contact === undefined ? { memory: "Memoria vieja", updatedAt: "2026-10-01T00:00:00Z" } : over.contact;
  const hooks: Array<() => void> = [];
  const state = contact ? { ...contact } : null;
  const db = fakeDb({
    "calls:select": { data: over.call === null ? null : callRow(over.call ?? {}) },
    "calls:update": { data: [{ id: "c1" }] },
    "workspaces:select": { data: { timezone: "America/Costa_Rica" } },
    "contacts:select": (c: DbCall) =>
      c.filters.some((f) => f.column === "id") && state
        ? { data: { ai_conversation_summary: state.memory, ai_summary_updated_at: state.updatedAt, display_name: "Ana Pérez", email: null } }
        : { data: null },
    "contacts:update": (c: DbCall) => {
      hooks.shift()?.();
      if (!state) return { data: [] };
      const guard = c.filters.find((f) => f.column === "ai_summary_updated_at");
      const ok = guard?.method === "is" ? state.updatedAt === null : guard?.value === state.updatedAt;
      if (!ok) return { data: [] };
      const v = c.values as { ai_conversation_summary: string; ai_summary_updated_at: string };
      state.memory = v.ai_conversation_summary;
      state.updatedAt = v.ai_summary_updated_at;
      return { data: [{ id: "ct1" }] };
    },
    "content_ideas:select": { data: over.ideasLast === null ? null : { position: over.ideasLast ?? 30 } },
    "content_ideas:insert": { data: null },
    "scheduled_jobs:insert": { data: { id: "j" } },
  });
  return { db, state, beforeNextContactUpdate: (fn: () => void) => hooks.push(fn) };
}
const gen = (obj: Record<string, unknown> = summary()) => vi.fn().mockResolvedValue({ object: obj, usage: { inputTokens: 10 } });
const callUpdates = (s: ReturnType<typeof setup>) => s.db.writesTo("calls").map((c) => c.values as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openAiRun.mockResolvedValue(run);
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.model.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "sonnet", chosen: false });
  mocks.instructions.mockResolvedValue({ version: null, text: "Resumí en {{estilo}}" });
});

describe("runCallSummaryJob: el resumen y las ideas (F29)", () => {
  it("guarda el resumen (sin la memoria) y marca done", async () => {
    const s = setup();
    const r = await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1" });
    expect(r.outcome).toBe("done");
    const final = callUpdates(s).at(-1)!;
    expect(final).toMatchObject({ summary_status: "done" });
    expect(final.summary).toMatchObject({ resumen: "Resumen", proximos_pasos: "Llamar", sentimiento: "neutral", model: "anthropic/sonnet" });
    expect(final.summary).not.toHaveProperty("memoria");
    expect(mocks.openAiRun.mock.calls[0][1]).toMatchObject({ source: "call_summary", threadId: "c1", contactId: "ct1" });
  });

  it("con 3 ideas, crea 3 content_ideas con source 'call', status 'nueva' y el call_id", async () => {
    const s = setup({ ideasLast: 30 });
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1" });
    const rows = s.db.writesTo("content_ideas")[0].values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "call" && r.status === "nueva" && r.call_id === "c1" && r.created_by === null && r.workspace_id === "ws1")).toBe(true);
    expect(rows.map((r) => r.position)).toEqual([40, 50, 60]);
    expect(rows[0]).toMatchObject({ title: "Idea 1", format: "Reel" });
    expect(String(rows[0].content)).toContain("De la llamada del 9 de octubre de 2026 con Ana Pérez");
    expect(callUpdates(s).at(-1)).toMatchObject({ ideas_created_at: NOW.toISOString() });
  });

  it("al volver a resumir la misma llamada NO crea ideas nuevas", async () => {
    const s = setup({ call: { ideas_created_at: "2026-10-09T20:00:00Z" } });
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1", manual: true });
    expect(s.db.writesTo("content_ideas")).toHaveLength(0);
    expect(callUpdates(s).at(-1)).not.toHaveProperty("ideas_created_at");
  });

  it("si no se pudieron crear las ideas, el resumen igual sale y ideas_created_at queda vacio para reintentar", async () => {
    const s = setup();
    const failing = fakeDb({
      "calls:select": { data: callRow() },
      "calls:update": { data: [{ id: "c1" }] },
      "workspaces:select": { data: { timezone: "UTC" } },
      "contacts:select": { data: { ai_conversation_summary: null, ai_summary_updated_at: null, display_name: "Ana" } },
      "contacts:update": { data: [{ id: "ct1" }] },
      "content_ideas:select": { data: null },
      "content_ideas:insert": { error: { message: "boom" } },
    });
    const r = await runCallSummaryJob({ db: failing.client, now: NOW, generate: gen() }, { callId: "c1" });
    expect(r.outcome).toBe("done");
    const final = failing.writesTo("calls").map((c) => c.values as Record<string, unknown>).at(-1)!;
    expect(final.summary_status).toBe("done");
    expect(final).not.toHaveProperty("ideas_created_at");
  });

  it("una llamada de equipo no llama al modelo ni abre run", async () => {
    const s = setup({ call: { call_type: "equipo" } });
    const generate = gen();
    const r = await runCallSummaryJob({ db: s.db.client, now: NOW, generate }, { callId: "c1" });
    expect(r.outcome).toBe("not_eligible");
    expect(generate).not.toHaveBeenCalled();
    expect(mocks.openAiRun).not.toHaveBeenCalled();
    expect(callUpdates(s)[0]).toMatchObject({ summary_status: "none" });
  });

  it("sin transcripcion tampoco", async () => {
    const s = setup({ call: { transcript: [] } });
    expect((await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1" })).outcome).toBe("not_eligible");
  });

  it("con el tope alcanzado no llama al modelo", async () => {
    mocks.budget.mockResolvedValue({ allowed: false });
    const s = setup();
    const generate = gen();
    expect((await runCallSummaryJob({ db: s.db.client, now: NOW, generate }, { callId: "c1" })).outcome).toBe("budget");
    expect(generate).not.toHaveBeenCalled();
    expect(callUpdates(s)[0]).toMatchObject({ summary_status: "error" });
  });

  it("un 429 reagenda a 1 minuto y deja pending; agotados los intentos queda en error", async () => {
    const s = setup();
    const err = Object.assign(new Error("rate"), { statusCode: 429 });
    expect((await runCallSummaryJob({ db: s.db.client, now: NOW, generate: vi.fn().mockRejectedValue(err) }, { callId: "c1", manual: true })).outcome).toBe("retry");
    const job = s.db.writesTo("scheduled_jobs")[0].values as { run_at: string; payload: Record<string, unknown> };
    expect(job.run_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(job.payload).toMatchObject({ callId: "c1", retry: 1, manual: true });
    expect(callUpdates(s).at(-1)).toMatchObject({ summary_status: "pending" });

    const s2 = setup();
    expect((await runCallSummaryJob({ db: s2.db.client, now: NOW, generate: vi.fn().mockRejectedValue(err) }, { callId: "c1", retry: 3 })).outcome).toBe("error");
    expect(callUpdates(s2).at(-1)).toMatchObject({ summary_status: "error" });
  });
});

describe("runCallSummaryJob: la memoria del contacto (F30)", () => {
  it("con memoria previa: queda la integrada y hay auditoria con el valor anterior", async () => {
    const s = setup();
    const generate = gen();
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate }, { callId: "c1" });
    expect(s.state?.memory).toBe("Memoria integrada");
    expect(generate.mock.calls[0][0].prompt).toContain("Memoria vieja");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "contact",
        entityId: "ct1",
        action: "summary",
        changes: { ai_conversation_summary: { old: "Memoria vieja", new: "Memoria integrada" } },
        metadata: { origin: "call_summary", call_id: "c1" },
        label: "Resumen de llamada",
      }),
    );
    expect(callUpdates(s).at(-1)).toMatchObject({ memory_status: "applied", memory_applied_at: NOW.toISOString() });
  });

  it("si el cierre de una conversacion escribio en el medio, no se pierde lo suyo: la segunda pasada parte del valor nuevo", async () => {
    const s = setup();
    s.beforeNextContactUpdate(() => {
      if (s.state) { s.state.memory = "Escrita por el cierre"; s.state.updatedAt = "2026-10-10T11:59:00Z"; }
    });
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ object: summary({ memoria: "Integrada sobre la vieja" }) })
      .mockResolvedValueOnce({ object: summary({ memoria: "Integrada sobre la del cierre" }) });
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate }, { callId: "c1" });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].prompt).toContain("Escrita por el cierre");
    expect(s.state?.memory).toBe("Integrada sobre la del cierre");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ changes: { ai_conversation_summary: { old: "Escrita por el cierre", new: "Integrada sobre la del cierre" } } }));
  });

  it("si vuelve a chocar: memory_status 'conflict', el resumen igual queda done", async () => {
    const s = setup();
    s.beforeNextContactUpdate(() => { if (s.state) { s.state.memory = "A"; s.state.updatedAt = "2026-10-10T11:58:00Z"; } });
    s.beforeNextContactUpdate(() => { if (s.state) { s.state.memory = "B"; s.state.updatedAt = "2026-10-10T11:59:00Z"; } });
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1" });
    expect(s.state?.memory).toBe("B");
    expect(callUpdates(s).at(-1)).toMatchObject({ summary_status: "done", memory_status: "conflict" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("sin contacto: no se toca ningun contacto y la memoria del modelo se ignora", async () => {
    const s = setup({ call: { contact_id: null } });
    const generate = gen();
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate }, { callId: "c1" });
    expect(s.db.writesTo("contacts")).toHaveLength(0);
    expect(generate.mock.calls[0][0].prompt).not.toContain("Memoria previa del contacto");
    expect(callUpdates(s).at(-1)).toMatchObject({ memory_status: "none" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("una llamada de equipo no toca la memoria (ni siquiera se resume)", async () => {
    const s = setup({ call: { call_type: "equipo" } });
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen() }, { callId: "c1" });
    expect(s.db.writesTo("contacts")).toHaveLength(0);
  });

  it("si el modelo no devuelve memoria, queda skipped y el contacto no cambia", async () => {
    const s = setup();
    await runCallSummaryJob({ db: s.db.client, now: NOW, generate: gen(summary({ memoria: null })) }, { callId: "c1" });
    expect(s.state?.memory).toBe("Memoria vieja");
    expect(callUpdates(s).at(-1)).toMatchObject({ memory_status: "skipped" });
  });
});
