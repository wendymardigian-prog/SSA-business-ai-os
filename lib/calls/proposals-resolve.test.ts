import { describe, expect, it, vi } from "vitest";
import { resolveProposal, type ResolveDeps, type ResolveCall } from "./proposals-resolve";
import type { Proposal } from "./proposals";

const NOW = new Date("2026-11-12T10:00:00Z");
const prop = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  type: "tarea",
  status: "pending",
  original: { titulo: "Mandar el contrato", detalle: "Lo pidió", vence_en_dias: 2, responsable: "servicio" },
  edited: null,
  result: null,
  ...over,
});
const call = (proposals: Proposal[], over: Partial<ResolveCall> = {}): ResolveCall => ({
  id: "c1",
  workspaceId: "w",
  contactId: "ct1",
  serviceId: "s1",
  recordedBy: "u-rec",
  proposals,
  ...over,
});

function deps(over: Partial<ResolveDeps> & { call?: ResolveCall; perms?: string[] } = {}): ResolveDeps {
  const perms = new Set(over.perms ?? ["calls.edit", "tasks.edit", "services.items"]);
  return {
    loadCall: vi.fn(async () => over.call ?? call([prop()])),
    can: (k: string) => perms.has(k),
    claim: vi.fn(async () => true),
    patch: vi.fn(async () => undefined),
    serviceOwner: vi.fn(async () => "u-owner"),
    createTask: vi.fn(async () => ({ ok: true as const, id: "t1" })),
    completeStep: vi.fn(async () => ({ ok: true as const, id: "it1" })),
    sendMessage: vi.fn(async () => ({ ok: true as const, id: "m1" })),
    notify: vi.fn(async () => ({ ok: true as const, id: "n1" })),
    audit: vi.fn(async () => undefined),
    now: () => NOW,
    ...over,
  };
}

const base = { callId: "c1", proposalId: "p1", actorId: "u-me" };

describe("resolveProposal", () => {
  it("sin calls.edit rechaza sin tocar nada", async () => {
    const d = deps({ perms: ["tasks.edit"] });
    const r = await resolveProposal(d, { ...base, decision: "approve" });
    expect(r).toMatchObject({ ok: false, status: "rejected" });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("aprobar una tarea: la crea con source call, la reunión, el servicio y el contacto, y queda done", async () => {
    const d = deps();
    const r = await resolveProposal(d, { ...base, decision: "approve" });
    expect(r).toEqual({ ok: true, status: "done", result: { task_id: "t1" } });
    expect(d.createTask).toHaveBeenCalledWith({ title: "Mandar el contrato", description: "Lo pidió", dueInDays: 2, ownerId: "u-owner", contactId: "ct1", serviceId: "s1", callId: "c1" });
    expect(d.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ status: "done", result: { task_id: "t1" }, resolved_by: "u-me" }));
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.proposal_approved" }));
  });

  it("sin la clave de lo que hace (tareas), la tarjeta dice qué falta", async () => {
    const r = await resolveProposal(deps({ perms: ["calls.edit"] }), { ...base, decision: "approve" });
    expect(r).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/tareas/) });
  });

  it("editar y aprobar: guarda lo editado y el historial dice qué cambió", async () => {
    const d = deps();
    await resolveProposal(d, { ...base, decision: "approve", edits: { titulo: "Mandar el contrato firmado", vence_en_dias: 5 } });
    expect(d.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: "Mandar el contrato firmado", dueInDays: 5 }));
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.proposal_edited", changes: { titulo: { old: "Mandar el contrato", new: "Mandar el contrato firmado" }, vence_en_dias: { old: 2, new: 5 } } }));
  });

  it("si otra persona ya la reclamó: «Ya la resolvió otra persona», sin ejecutar", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    const r = await resolveProposal(d, { ...base, decision: "approve" });
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "Ya la resolvió otra persona." });
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("descartar no ejecuta nada y guarda quién y cuándo", async () => {
    const d = deps();
    const r = await resolveProposal(d, { ...base, decision: "discard" });
    expect(r).toEqual({ ok: true, status: "discarded", result: null });
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ status: "discarded", resolved_by: "u-me", resolved_at: NOW.toISOString() }));
  });

  it("un paso bloqueado o sin evidencia queda failed con el motivo y el paso pendiente", async () => {
    const d = deps({ call: call([prop({ type: "paso", original: { titulo: "", detalle: "", item_key: "it_abc123" } })]), completeStep: vi.fn(async () => ({ ok: false as const, reason: "Este paso pide evidencia: adjuntá una captura, un link o una nota." })) });
    const r = await resolveProposal(d, { ...base, decision: "approve" });
    expect(r).toMatchObject({ ok: false, status: "failed", error: expect.stringMatching(/evidencia/) });
    expect(d.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ status: "failed" }));
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.proposal_failed" }));
  });

  describe("mensaje (F144)", () => {
    const msg = prop({ type: "mensaje", original: { titulo: "Mensaje", detalle: "", texto: "Hola, te dejo el resumen", para: "cliente" } });
    it("sin destino, rechaza sin ejecutar", async () => {
      const d = deps({ call: call([msg]) });
      const r = await resolveProposal(d, { ...base, decision: "approve" });
      expect(r).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/Elegí/) });
      expect(d.sendMessage).not.toHaveBeenCalled();
    });
    it("con el chat del contacto: manda el texto editado una vez y guarda el id del mensaje", async () => {
      const d = deps({ call: call([msg]) });
      const r = await resolveProposal(d, { ...base, decision: "approve", destination: { kind: "conversation", id: "conv1" }, edits: { texto: "Hola Ana, te dejo el resumen" } });
      expect(r).toEqual({ ok: true, status: "done", result: { message_id: "m1" } });
      expect(d.sendMessage).toHaveBeenCalledTimes(1);
      expect(d.sendMessage).toHaveBeenCalledWith({ destination: { kind: "conversation", id: "conv1" }, text: "Hola Ana, te dejo el resumen", retryOf: null });
    });
    it("si el envío falla queda failed y el reintento usa el mismo mensaje (sin duplicar)", async () => {
      const failed = { ...msg, status: "failed" as const, result: { message_id: "m-fallido" } };
      const d = deps({ call: call([failed]) });
      await resolveProposal(d, { ...base, decision: "approve", destination: { kind: "conversation", id: "conv1" } });
      expect(d.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ retryOf: "m-fallido" }));
      const d2 = deps({ call: call([msg]), sendMessage: vi.fn(async () => ({ ok: false as const, reason: "WhatsApp no respondió", messageId: "m9" })) });
      const r2 = await resolveProposal(d2, { ...base, decision: "approve", destination: { kind: "conversation", id: "conv1" } });
      expect(r2).toMatchObject({ ok: false, status: "failed" });
      expect(d2.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ status: "failed", result: { message_id: "m9" } }));
    });
  });

  it("un aviso va al responsable del servicio o a quien grabó", async () => {
    const d = deps({ call: call([prop({ type: "aviso", original: { titulo: "Ojo", detalle: "x", para: "grabo" } })]) });
    await resolveProposal(d, { ...base, decision: "approve" });
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: "u-rec" }));
  });

  it("una propuesta ya resuelta no se vuelve a ejecutar", async () => {
    const d = deps({ call: call([prop({ status: "done" })]) });
    expect(await resolveProposal(d, { ...base, decision: "approve" })).toMatchObject({ ok: false, status: "rejected" });
    expect(d.claim).not.toHaveBeenCalled();
  });
});
