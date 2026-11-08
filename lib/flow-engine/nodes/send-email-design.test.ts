/**
 * «Enviar email» con el PDF del diseño generado (Diseñador IA, F59). Los adjuntos de recursos siguen igual (lo fijan
 * `send-email.test.ts` y `lib/email/attachments-characterization.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendTransactionalEmail, recordSkippedEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (_p: Record<string, unknown>) => ({ ok: true as const, id: "msg-1" }) as Record<string, unknown>),
  recordSkippedEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail, recordSkippedEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => true), createNotificationOnce: vi.fn(async () => true) }));

import { NO_DESIGN_TO_ATTACH, sendEmailNode } from "./send-email";
import * as loader from "@/lib/email/flow-attachments";
import { memoryDb } from "@/lib/agent/testing/memory-db";

function world() {
  return memoryDb({
    contacts: [{ id: "c-1", workspace_id: "ws-1", email: "ana@ejemplo.com", display_name: "Ana", phone: null, do_not_contact: false }],
    workspaces: [{ id: "ws-1", name: "Academia Ejemplo" }],
    flows: [{ id: "f-1", workspace_id: "ws-1", trigger_scope: null }],
    scheduled_jobs: [],
    flow_sessions: [{ id: "s1" }],
    analytics_events: [],
    notifications: [],
  });
}

function args(db: ReturnType<typeof world>, variables: Record<string, unknown>, sessionId: string | undefined = "s1") {
  const notes: Array<{ status: string; reason?: unknown }> = [];
  const context = { workspaceId: "ws-1", contactId: "c-1", flowId: "f-1", channelId: "", conversationId: "", variables, noteStep: (n: { status: string; reason?: unknown }) => notes.push(n) };
  return {
    notes,
    context,
    input: {
      supabase: db.client,
      data: { to: "contact", subject: "Tu constancia", body: "Acá está: {{design.link}}", attachments: [{ kind: "design", from: "design" }] },
      context,
      node: { id: "n-1" },
      sessionId,
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("«Enviar email» con el PDF del diseño (F59)", () => {
  it("con la generación lista, el PDF viaja como adjunto y se busca la de ESTA corrida", async () => {
    const spy = vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [{ filename: "constancia-ana-perez.pdf", content: "JVBERg==" }], missing: [] });
    const db = world();
    const { input, notes } = args(db, { design: { id: "d-1", link: "https://links.ejemplo.com/d/K8F2-WQ4M-7TQA" } });
    await sendEmailNode.execute(input);
    expect(spy).toHaveBeenCalledWith(db.client, { workspaceId: "ws-1", refs: [{ kind: "design", from: "design" }], designId: "d-1" });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ filename: "constancia-ana-perez.pdf", content: "JVBERg==" }] }));
    expect(notes.filter((n) => n.status === "failed")).toEqual([]);
  });

  it("sin generación en la corrida, el paso falla con el motivo y el email no sale", async () => {
    vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [], missing: [], designProblem: "missing" });
    const db = world();
    const { input, notes } = args(db, {});
    await sendEmailNode.execute(input);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "failed", reason: NO_DESIGN_TO_ATTACH }]);
    expect(NO_DESIGN_TO_ATTACH).toBe("No hay un diseño generado en esta automatización.");
  });

  it("si el diseño de la corrida falló o se anuló, el paso falla con un motivo claro y el email no sale", async () => {
    vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [], missing: [], designProblem: "failed" });
    const db = world();
    const { input, notes } = args(db, { design: { id: "d-1" } });
    await sendEmailNode.execute(input);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "failed", reason: "El diseño de esta automatización no se pudo generar (o se anuló): el email no salió." }]);
  });

  it("si todavía no está listo, el email no sale y el paso queda para después", async () => {
    vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [], missing: [], designProblem: "not_ready" });
    const db = world();
    const { input, notes } = args(db, { design: { id: "d-1" } });
    expect(await sendEmailNode.execute(input)).toBe("pause");
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(db.tables.scheduled_jobs).toHaveLength(1);
    expect((db.tables.scheduled_jobs[0].payload as { rerunNode: boolean }).rerunNode).toBe(true);
    expect(notes.at(-1)).toMatchObject({ status: "deferred" });
  });

  it("después de tres esperas, el paso falla sin mandar", async () => {
    vi.spyOn(loader, "loadEmailAttachments").mockResolvedValue({ files: [], missing: [], designProblem: "not_ready" });
    const db = world();
    const { input, notes } = args(db, { design: { id: "d-1" }, __provider_retries: { "n-1": 3 } });
    await sendEmailNode.execute(input);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "failed", reason: "El PDF del diseño no estuvo listo a tiempo: el email no salió." }]);
  });
});

describe("loadEmailAttachments: la rama del diseño (F59)", () => {
  function storageWorld(design: Record<string, unknown> | null, pdfBytes = 4) {
    const db = memoryDb({ response_assets: [], designs: design ? [{ id: "d-1", workspace_id: "ws-1", name: "Constancia · Ana Pérez", ...design }] : [] });
    const download = vi.fn(async (_bucket: string, _path: string) => ({ data: new Blob([new Uint8Array(pdfBytes).fill(37)]), error: null }));
    (db.client as unknown as { storage: unknown }).storage = { from: (bucket: string) => ({ download: (p: string) => download(bucket, p) }) };
    return { db, download };
  }
  const refs = [{ kind: "design" as const, from: "design" as const }];

  it("lista: baja el PDF del bucket de renders con un nombre legible", async () => {
    vi.restoreAllMocks();
    const { db, download } = storageWorld({ status: "ready", renders: { pdf_path: "ws-1/d-1/renders/v/document.pdf" } });
    const out = await loader.loadEmailAttachments(db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" });
    expect(download).toHaveBeenCalledWith("design-renders", "ws-1/d-1/renders/v/document.pdf");
    expect(out.files).toEqual([{ filename: "Constancia-Ana-Perez.pdf", content: "JSUlJQ==" }]);
    expect(out.designProblem).toBeUndefined();
  });

  it("sin id, de otro negocio, fallida o anulada: missing; en preparación: not_ready", async () => {
    vi.restoreAllMocks();
    expect((await loader.loadEmailAttachments(storageWorld({ status: "ready" }).db.client as never, { workspaceId: "ws-1", refs, designId: null })).designProblem).toBe("missing");
    expect((await loader.loadEmailAttachments(storageWorld({ status: "ready", workspace_id: "otro" }).db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" })).designProblem).toBe("missing");
    expect((await loader.loadEmailAttachments(storageWorld({ status: "failed" }).db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" })).designProblem).toBe("failed");
    expect((await loader.loadEmailAttachments(storageWorld({ status: "void" }).db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" })).designProblem).toBe("failed");
    expect((await loader.loadEmailAttachments(storageWorld({ status: "rendering" }).db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" })).designProblem).toBe("not_ready");
  });

  it("si no entra en el tope de 25 MB, queda como faltante", async () => {
    vi.restoreAllMocks();
    const { db } = storageWorld({ status: "ready", renders: { pdf_path: "x.pdf" } }, 26 * 1024 * 1024);
    const out = await loader.loadEmailAttachments(db.client as never, { workspaceId: "ws-1", refs, designId: "d-1" });
    expect(out.files).toEqual([]);
    expect(out.missing).toEqual(["Constancia · Ana Pérez"]);
  });
});
