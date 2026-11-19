import { describe, expect, it, vi } from "vitest";
import { resolveProposal, type ResolveDeps, type ResolveCall } from "./proposals-resolve";
import { DEFAULT_PROPOSAL_APPROVERS, type Proposal } from "./proposals";

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
    createIdea: vi.fn(async () => ({ ok: true as const, id: "idea1" })),
    createDraft: vi.fn(async () => ({ ok: true as const, id: "post1", ideaId: "idea2" })),
    approvers: DEFAULT_PROPOSAL_APPROVERS,
    isAdmin: true,
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
    expect(d.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ status: "discarded", resolved_by: "u-me", resolved_at: NOW.toISOString(), discard_reason: "no_hace_falta", discard_note: null }));
  });

  it("descartar con motivo lo guarda y queda en el historial; «Otro» pide la nota", async () => {
    const d = deps();
    await resolveProposal(d, { ...base, decision: "discard", discardReason: "dato_incorrecto" });
    expect(d.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ discard_reason: "dato_incorrecto" }));
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.proposal_discarded", metadata: expect.objectContaining({ discard_reason: "dato_incorrecto" }) }));
    const d2 = deps();
    expect(await resolveProposal(d2, { ...base, decision: "discard", discardReason: "otro" })).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/Otro/) });
    expect(d2.claim).not.toHaveBeenCalled();
    const d3 = deps();
    await resolveProposal(d3, { ...base, decision: "discard", discardReason: "otro", discardNote: "  ya lo hicimos  " });
    expect(d3.patch).toHaveBeenCalledWith("c1", "p1", expect.objectContaining({ discard_reason: "otro", discard_note: "ya lo hicimos" }));
  });

  describe("quién aprueba", () => {
    it("el responsable del servicio decide lo que el ajuste le da", async () => {
      const d = deps({ isAdmin: false });
      expect(await resolveProposal(d, { ...base, actorId: "u-owner", decision: "approve" })).toMatchObject({ ok: true, status: "done" });
    });
    it("otra persona (ni admin ni responsable) no puede ni aprobar ni descartar", async () => {
      for (const decision of ["approve", "discard"] as const) {
        const d = deps({ isAdmin: false });
        expect(await resolveProposal(d, { ...base, actorId: "u-otro", decision })).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/La decide/) });
        expect(d.claim).not.toHaveBeenCalled();
      }
    });
    it("sin servicio, el responsable es quien grabó", async () => {
      const d = deps({ isAdmin: false, call: call([prop()], { serviceId: null }) });
      expect(await resolveProposal(d, { ...base, actorId: "u-rec", decision: "approve" })).toMatchObject({ ok: true });
    });
    it("lo que el ajuste deja en «Un admin», el responsable no lo puede decidir", async () => {
      const d = deps({ isAdmin: false, approvers: { ...DEFAULT_PROPOSAL_APPROVERS, tarea: "admin" } });
      expect(await resolveProposal(d, { ...base, actorId: "u-owner", decision: "approve" })).toMatchObject({ ok: false, status: "rejected" });
    });
  });

  describe("contenido (idea y borrador)", () => {
    const idea = prop({ type: "idea", original: { titulo: "De 3 a 12 visitas", detalle: "Caso real", cita: "pasamos de 3 a 12", formato: "Reel" } });
    const draft = prop({ type: "borrador", original: { titulo: "El anuncio que nadie explica", detalle: "", cita: "nadie nos explicó", formato: "Reel", guion: "Nadie te explica esto." } });
    const contentPerms = ["calls.edit", "content.create", "content.approve"];
    it("aprobar una idea la manda al banco y guarda su id", async () => {
      const d = deps({ call: call([idea], { contactId: null }), perms: contentPerms });
      expect(await resolveProposal(d, { ...base, decision: "approve" })).toEqual({ ok: true, status: "done", result: { idea_id: "idea1" } });
      expect(d.createIdea).toHaveBeenCalledWith({ proposal: expect.objectContaining({ titulo: "De 3 a 12 visitas", cita: "pasamos de 3 a 12" }), callId: "c1" });
    });
    it("aprobar un borrador crea la pieza con el guion editado", async () => {
      const d = deps({ call: call([draft]), perms: contentPerms });
      const r = await resolveProposal(d, { ...base, decision: "approve", edits: { guion: "Te lo cuento." } });
      expect(r).toEqual({ ok: true, status: "done", result: { post_id: "post1", idea_id: "idea2" } });
      expect(d.createDraft).toHaveBeenCalledWith({ proposal: expect.objectContaining({ guion: "Te lo cuento." }), callId: "c1" });
      expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "call.proposal_edited", changes: { guion: { old: "Nadie te explica esto.", new: "Te lo cuento." } } }));
    });
    it("un borrador sin guion no se aprueba", async () => {
      const d = deps({ call: call([draft]), perms: contentPerms });
      expect(await resolveProposal(d, { ...base, decision: "approve", edits: { guion: "   " } })).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/guion/) });
      expect(d.createDraft).not.toHaveBeenCalled();
    });
    it("los permisos son los de Contenido: crear la idea; el borrador además aprobar", async () => {
      const d = deps({ call: call([draft]), perms: ["calls.edit", "content.create"] });
      expect(await resolveProposal(d, { ...base, decision: "approve" })).toMatchObject({ ok: false, status: "rejected", error: expect.stringMatching(/aprobar contenido/) });
    });
    it("por defecto, el contenido lo decide un admin (no el responsable)", async () => {
      const d = deps({ call: call([idea]), perms: contentPerms, isAdmin: false });
      expect(await resolveProposal(d, { ...base, actorId: "u-owner", decision: "approve" })).toMatchObject({ ok: false, status: "rejected" });
    });
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
