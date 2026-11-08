import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { DESIGN_PENDING_VAR, designGenerateNode, runDesignGenerate, type DesignGenerateDeps } from "./design-generate";
import { DESIGN_STOP_HANDLE, type DesignGenerateNodeData } from "@/lib/designer/automation/node-config";
import type { CreateGenerationInput, CreateGenerationResult } from "@/lib/designer/generate-core";
import type { FlowExecutionContext } from "../types";

const WS = "ws-1";
const TPL = "tpl-1";

const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: "c-1",
  memberUserId: null,
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: { contact: { first_name: "Ana", display_name: "Ana Pérez" }, answer: { nombre_certificado: "Ana María Pérez", vacia: "" } },
  ...over,
});

function world(template: Record<string, unknown> = {}) {
  return memoryDb({
    workspaces: [{ id: WS, timezone: "America/Argentina/Buenos_Aires", scheduling_public_base_url: null }],
    design_templates: [
      { id: TPL, workspace_id: WS, name: "Constancia del curso", date_format: "long", verify: true, doc_type: "constancia", doc_type_label: null, archived_at: null, ...template },
    ],
    designs: [],
    scheduled_jobs: [],
    flow_sessions: [{ id: "s1", workspace_id: WS }],
    analytics_events: [],
  });
}

function deps(over: Partial<DesignGenerateDeps> & { result?: CreateGenerationResult } = {}) {
  const calls: CreateGenerationInput[] = [];
  const base: DesignGenerateDeps = {
    createGeneration: vi.fn(async (_db, input: CreateGenerationInput): Promise<CreateGenerationResult> => {
      calls.push(input);
      return over.result ?? { ok: true, designId: "d-1", code: "K8F2-WQ4M-7TQA", status: "queued", missing: [] };
    }),
    runDesignRender: vi.fn(async () => ({ status: "rendered" as const, set: { version: "v", pdf_path: "p.pdf", pages: [], rendered_at: "" } })),
    loadDesignLinks: vi.fn(async (_db, _ws, code: string) => ({ link: `https://links.ejemplo.com/d/${code}`, pdfUrl: `https://links.ejemplo.com/d/${code}/descargar?formato=pdf`, zipUrl: "" })),
    now: () => new Date("2026-11-07T15:00:00Z"),
  };
  return { deps: { ...base, ...over } as DesignGenerateDeps, calls };
}

const node = { id: "n1", type: "action", position: { x: 0, y: 0 }, data: {} };

function run(db: ReturnType<typeof world>, data: DesignGenerateNodeData, d: DesignGenerateDeps, context = ctx()) {
  return runDesignGenerate({ supabase: db.client, node, data, context, sessionId: "s1", runtime: { executeFlow: async () => {} } } as never, d);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("«Generar desde plantilla» (F57)", () => {
  it("con el dato del formulario, la generación lleva ese valor y la corrida como origen", async () => {
    const db = world();
    const { deps: d, calls } = deps();
    const context = ctx();
    const notes: unknown[] = [];
    context.noteStep = (n) => notes.push(n);
    const out = await run(db, { templateId: TPL, mappings: { nombre_en_el_certificado: { mode: "variable", path: "answer.nombre_certificado" }, fecha: { mode: "today" } } }, d, context);
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceId: WS,
      templateId: TPL,
      contactId: "c-1",
      policy: "fail",
      publish: true,
      source: "automation",
      sourceRef: { kind: "automation", flow_id: "flow-1", session_id: "s1", node_id: "n1" },
      actorUserId: null,
      // Con «Esperar el PDF» el render corre acá, no en la cola.
      enqueueRender: false,
    });
    expect(calls[0].overrides).toEqual({ nombre_en_el_certificado: "Ana María Pérez", fecha: "7 de noviembre de 2026" });
    expect(d.runDesignRender).toHaveBeenCalledTimes(1);
    expect(notes).toEqual([]);
  });

  it("deja las seis salidas con los links del dominio del negocio (F58)", async () => {
    const db = world();
    const { deps: d } = deps();
    const context = ctx();
    await run(db, { templateId: TPL }, d, context);
    expect((context.variables as Record<string, unknown>).design).toEqual({
      id: "d-1",
      link: "https://links.ejemplo.com/d/K8F2-WQ4M-7TQA",
      pdf_url: "https://links.ejemplo.com/d/K8F2-WQ4M-7TQA/descargar?formato=pdf",
      code: "K8F2-WQ4M-7TQA",
      status: "ready",
      doc_type: "Constancia",
    });
    expect(d.loadDesignLinks).toHaveBeenCalledWith(db.client, WS, "K8F2-WQ4M-7TQA");
  });

  it("con la respuesta vacía y «No generar», termina con el error y la generación queda failed", async () => {
    const db = world();
    const { deps: d, calls } = deps({ result: { ok: true, designId: "d-1", code: "K8F2-WQ4M-7TQA", status: "failed", missing: [{ key: "nombre_en_el_certificado", label: "Nombre en el certificado" }] } });
    const context = ctx();
    const notes: Array<{ status: string; reason?: unknown }> = [];
    context.noteStep = (n) => notes.push(n);
    const out = await run(db, { templateId: TPL, mappings: { nombre_en_el_certificado: { mode: "variable", path: "answer.vacia" } } }, d, context);
    // Lo vacío no se pasa: decide la política (nunca un certificado vacío).
    expect(calls[0].overrides).toEqual({});
    expect(out).toBe(DESIGN_STOP_HANDLE);
    expect(notes).toEqual([{ status: "failed", reason: "Falta: Nombre en el certificado" }]);
    expect(d.runDesignRender).not.toHaveBeenCalled();
    expect((context.variables as { design: { status: string } }).design.status).toBe("failed");
  });

  it("sin «Esperar el PDF» el render va a la cola y el flujo sigue con «En preparación»", async () => {
    const db = world();
    const { deps: d, calls } = deps();
    const context = ctx();
    const out = await run(db, { templateId: TPL, waitForPdf: false, publish: false, missingPolicy: "empty" }, d, context);
    expect(out).toBeUndefined();
    expect(calls[0]).toMatchObject({ enqueueRender: true, publish: false, policy: "empty" });
    expect(d.runDesignRender).not.toHaveBeenCalled();
    expect((context.variables as { design: { status: string } }).design.status).toBe("queued");
  });

  it("si el render falla de forma pasajera, se deja para después con la MISMA generación y no encola otro render", async () => {
    const db = world();
    db.tables.designs.push({ id: "d-1", workspace_id: WS, code: "K8F2-WQ4M-7TQA", status: "rendering", error: "El servicio de render no respondió." });
    const { deps: d, calls } = deps({ runDesignRender: vi.fn(async () => ({ status: "retry" as const, attempt: 1, at: "2026-11-07T15:01:00.000Z", error: "El servicio de render no respondió." })) });
    const context = ctx();
    const notes: Array<{ status: string; resumesAt?: string | null }> = [];
    context.noteStep = (n) => notes.push(n);
    expect(await run(db, { templateId: TPL }, d, context)).toBe("pause");
    expect((context.variables as Record<string, unknown>)[DESIGN_PENDING_VAR]).toEqual({ n1: "d-1" });
    // El render no se reagenda solo: lo reintenta el paso (un único reloj).
    const renderDeps = (d.runDesignRender as ReturnType<typeof vi.fn>).mock.calls[0][2] as { schedule: () => Promise<unknown> };
    expect(typeof renderDeps.schedule).toBe("function");
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    expect(db.tables.scheduled_jobs[0]).toMatchObject({ type: "resume_flow", run_at: "2026-11-07T15:01:00.000Z" });
    expect((db.tables.scheduled_jobs[0].payload as { rerunNode: boolean }).rerunNode).toBe(true);
    expect(notes.at(-1)).toMatchObject({ status: "deferred", resumesAt: "2026-11-07T15:01:00.000Z" });

    // Al volver: no crea otra generación; renderiza la misma y sigue.
    const back = ctx({ variables: { ...(context.variables as Record<string, unknown>) } as never });
    const { deps: d2, calls: calls2 } = deps();
    expect(await run(db, { templateId: TPL }, d2, back)).toBeUndefined();
    expect(calls2).toHaveLength(0);
    expect(d2.runDesignRender).toHaveBeenCalledWith(db.client, { designId: "d-1", purpose: "generation" }, expect.anything());
    expect((back.variables as Record<string, unknown>)[DESIGN_PENDING_VAR]).toBeUndefined();
    expect((back.variables as { design: { status: string } }).design.status).toBe("ready");
  });

  it("si el render sigue fallando, el camino termina con el error a la vista", async () => {
    const db = world();
    const { deps: d } = deps({ runDesignRender: vi.fn(async () => ({ status: "failed" as const, error: "Falta conectar el servicio de render" })) });
    const context = ctx();
    const notes: Array<{ status: string; reason?: unknown }> = [];
    context.noteStep = (n) => notes.push(n);
    expect(await run(db, { templateId: TPL }, d, context)).toBe(DESIGN_STOP_HANDLE);
    expect(notes).toEqual([{ status: "failed", reason: "Falta conectar el servicio de render" }]);
  });

  it("si ya tiene una válida, sigue con esa sin crear otra", async () => {
    const db = world();
    const { deps: d } = deps({ result: { ok: false, reason: "existing", existing: { designId: "d-viejo", code: "AAAA-BBBB-CCCC" } } });
    const context = ctx();
    expect(await run(db, { templateId: TPL }, d, context)).toBeUndefined();
    expect((context.variables as { design: { id: string; status: string } }).design).toMatchObject({ id: "d-viejo", status: "ready" });
    expect(d.runDesignRender).not.toHaveBeenCalled();
  });

  it("sin plantilla, archivada o con un error del núcleo: termina con el motivo y nunca lanza", async () => {
    for (const [data, template, result, reason] of [
      [{}, {}, undefined, "Elegí la plantilla del paso «Generar desde plantilla»."],
      [{ templateId: TPL }, { archived_at: "2026-11-01" }, undefined, "La plantilla está archivada."],
      [{ templateId: "otra" }, {}, undefined, "La plantilla ya no existe."],
      [{ templateId: TPL }, {}, { ok: false, reason: "error", error: "No se pudo guardar.", retryable: true }, "No se pudo guardar."],
    ] as const) {
      const db = world(template);
      const { deps: d } = deps(result ? { result: result as CreateGenerationResult } : {});
      const context = ctx();
      const notes: Array<{ status: string; reason?: unknown }> = [];
      context.noteStep = (n) => notes.push(n);
      expect(await run(db, data as DesignGenerateNodeData, d, context)).toBe(DESIGN_STOP_HANDLE);
      expect(notes).toEqual([{ status: "failed", reason }]);
    }
    const db = world();
    const { deps: d } = deps({ createGeneration: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(run(db, { templateId: TPL }, d)).resolves.toBe(DESIGN_STOP_HANDLE);
  });

  it("el registro: necesita contacto, persiste variables y declara sus salidas", () => {
    expect(designGenerateNode.needsContact).toBe(true);
    expect(designGenerateNode.persistsVariables).toBe(true);
    expect(designGenerateNode.outputs?.({}).map((o) => o.path)).toEqual(["design.id", "design.link", "design.pdf_url", "design.code", "design.status", "design.doc_type"]);
  });
});

describe("«Generar desde plantilla» nunca lanza (auditoría Ola 4)", () => {
  function failingJobs(db: ReturnType<typeof world>) {
    const from = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) =>
      table === "scheduled_jobs" ? { insert: async () => ({ error: { message: "la base no respondió" } }) } : from(table as never);
    return db;
  }

  it("si no se puede agendar el reintento, la generación queda failed con el motivo y el camino termina (no lanza)", async () => {
    const db = failingJobs(world());
    db.tables.designs.push({ id: "d-1", workspace_id: WS, code: "K8F2-WQ4M-7TQA", status: "rendering", error: null });
    const { deps: d } = deps({ runDesignRender: vi.fn(async () => ({ status: "retry" as const, attempt: 1, at: "2026-11-07T15:01:00.000Z", error: "El servicio de render no respondió." })) });
    const context = ctx();
    const notes: Array<{ status: string; reason?: unknown }> = [];
    context.noteStep = (n) => notes.push(n);
    await expect(run(db, { templateId: TPL }, d, context)).resolves.toBe(DESIGN_STOP_HANDLE);
    expect(notes.at(-1)).toEqual({ status: "failed", reason: "No se pudo agendar el reintento del PDF." });
    expect(db.tables.designs[0]).toMatchObject({ status: "failed", error: "No se pudo agendar el reintento del PDF." });
    expect((context.variables as Record<string, unknown>)[DESIGN_PENDING_VAR]).toBeUndefined();
  });

  it("un render que no pudo leer la generación se reintenta; uno que no la encuentra la deja failed", async () => {
    const db = world();
    db.tables.designs.push({ id: "d-1", workspace_id: WS, code: "K8F2-WQ4M-7TQA", status: "queued", error: null });
    const { deps: d } = deps({ runDesignRender: vi.fn(async () => ({ status: "skipped" as const, reason: "read_failed" })) });
    expect(await run(db, { templateId: TPL }, d)).toBe("pause");
    expect(db.tables.scheduled_jobs).toHaveLength(1);

    const db2 = world();
    db2.tables.designs.push({ id: "d-1", workspace_id: WS, code: "K8F2-WQ4M-7TQA", status: "queued", error: null });
    const { deps: d2 } = deps({ runDesignRender: vi.fn(async () => ({ status: "skipped" as const, reason: "not_found" })) });
    expect(await run(db2, { templateId: TPL }, d2)).toBe(DESIGN_STOP_HANDLE);
    expect(db2.tables.designs[0]).toMatchObject({ status: "failed", error: "El diseño generado ya no existe." });
  });

  it("«ya tenía uno» con su estado REAL: si todavía se está armando y hay que esperar el PDF, el paso espera esa pieza", async () => {
    const db = world();
    db.tables.designs.push({ id: "d-viejo", workspace_id: WS, code: "AAAA-BBBB-CCCC", status: "rendering", error: null });
    const { deps: d } = deps({ result: { ok: false, reason: "existing", existing: { designId: "d-viejo", code: "AAAA-BBBB-CCCC" } } });
    const context = ctx();
    expect(await run(db, { templateId: TPL }, d, context)).toBe("pause");
    expect((context.variables as Record<string, unknown>)[DESIGN_PENDING_VAR]).toEqual({ n1: "ajena:d-viejo" });

    // Al volver: una pieza ajena solo se MIRA (nunca se renderiza acá); si ya está lista, sigue.
    const render = vi.fn();
    const back = ctx({ variables: { ...(context.variables as Record<string, unknown>) } as never });
    const { deps: dBack } = deps({ runDesignRender: render as never });
    expect(await run(db, { templateId: TPL }, dBack, back)).toBe("pause");
    expect(render).not.toHaveBeenCalled();
    db.tables.designs[0].status = "ready";
    const back2 = ctx({ variables: { ...(back.variables as Record<string, unknown>) } as never });
    expect(await run(db, { templateId: TPL }, dBack, back2)).toBeUndefined();
    expect(render).not.toHaveBeenCalled();
    expect((back2.variables as { design: { id: string; status: string } }).design).toMatchObject({ id: "d-viejo", status: "ready" });

    db.tables.designs[0].status = "rendering";
    const { deps: d2 } = deps({ result: { ok: false, reason: "existing", existing: { designId: "d-viejo", code: "AAAA-BBBB-CCCC" } } });
    const context2 = ctx();
    expect(await run(db, { templateId: TPL, waitForPdf: false }, d2, context2)).toBeUndefined();
    expect((context2.variables as { design: { status: string } }).design.status).toBe("queued");
  });
});
