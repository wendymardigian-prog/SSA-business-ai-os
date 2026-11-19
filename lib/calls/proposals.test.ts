import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PROPOSAL_APPROVERS,
  buildProposalsInstructions,
  canDecideProposal,
  normalizeApprovers,
  parseDiscard,
  responsibleFor,
  effectiveProposal,
  mergeOnRegenerate,
  normalizeProposals,
  proposalDiff,
  readProposalsConfig,
  shouldPropose,
  type Proposal,
  type ProposalAction,
} from "./proposals";

const act = (over: Partial<ProposalAction>): ProposalAction => ({
  tipo: "tarea",
  titulo: "Mandar el contrato",
  detalle: "Lo pidió en la reunión",
  vence_en_dias: 2,
  responsable: "servicio",
  texto: null,
  item_key: null,
  para: null,
  cita: null,
  ...over,
});
let n = 0;
const id = () => `p${++n}`;

describe("shouldPropose", () => {
  it("solo con las propuestas prendidas, formato general y contexto suficiente", () => {
    const on = { enabled: true, client_message: false };
    expect(shouldPropose({ config: on, shape: "general", transcriptChars: 5000 })).toBe(true);
    expect(shouldPropose({ config: { enabled: false, client_message: false }, shape: "general", transcriptChars: 5000 })).toBe(false);
    expect(shouldPropose({ config: on, shape: "sales", transcriptChars: 5000 })).toBe(false);
    expect(shouldPropose({ config: on, shape: "general", transcriptChars: 100 })).toBe(false);
  });
  it("lee la configuración del analizador (nace apagada; el mensaje siempre necesita las propuestas prendidas)", () => {
    expect(readProposalsConfig(null)).toEqual({ enabled: false, client_message: false });
    expect(readProposalsConfig({ enabled: false, client_message: true })).toEqual({ enabled: false, client_message: false });
    expect(readProposalsConfig({ enabled: true, client_message: true })).toEqual({ enabled: true, client_message: true });
  });
});

describe("normalizeProposals", () => {
  const ctx = { hasContact: true, pendingItemKeys: ["it_abc123"], clientMessage: false };
  it("descarta un paso con una clave que no existe o ya está completa", () => {
    const out = normalizeProposals([act({ tipo: "paso", item_key: "it_zzzzzz" }), act({ tipo: "paso", item_key: "it_abc123" })], ctx, id);
    expect(out.map((p) => [p.type, p.original.item_key])).toEqual([["paso", "it_abc123"]]);
  });
  it("descarta un mensaje sin texto", () => {
    expect(normalizeProposals([act({ tipo: "mensaje", texto: "  " })], ctx, id)).toEqual([]);
  });
  it("sin contacto, solo quedan los avisos", () => {
    const out = normalizeProposals([act({}), act({ tipo: "aviso", para: "grabo", titulo: "Ojo" })], { ...ctx, hasContact: false }, id);
    expect(out.map((p) => p.type)).toEqual(["aviso"]);
  });
  it("nacen pendientes, con lo propuesto en original y como mucho 8", () => {
    const out = normalizeProposals(Array.from({ length: 12 }, () => act({})), ctx, id);
    expect(out).toHaveLength(8);
    expect(out[0]).toMatchObject({ status: "pending", edited: null, result: null, original: { titulo: "Mandar el contrato", vence_en_dias: 2, responsable: "servicio" } });
  });
  it("«Proponer siempre un mensaje»: si la IA no lo trajo, lo arma con el resumen y los próximos pasos", () => {
    const out = normalizeProposals([act({})], { ...ctx, clientMessage: true, summary: "Repasamos el avance.", nextSteps: ["Subir la captura"] }, id);
    const msg = out.find((p) => p.type === "mensaje");
    expect(msg?.original.texto).toContain("Repasamos el avance.");
    expect(msg?.original.texto).toContain("• Subir la captura");
  });
});

describe("regenerar", () => {
  it("la aprobada sigue y las pendientes se reemplazan", () => {
    const prev: Proposal[] = [
      { id: "a", type: "tarea", status: "done", original: { titulo: "x", detalle: "" }, edited: null, result: { task_id: "t1" } },
      { id: "b", type: "tarea", status: "pending", original: { titulo: "y", detalle: "" }, edited: null, result: null },
      { id: "c", type: "aviso", status: "pending", original: { titulo: "z", detalle: "" }, edited: null, result: null },
    ];
    const fresh = normalizeProposals([act({ titulo: "nueva" })], { hasContact: true, pendingItemKeys: [], clientMessage: false }, id);
    const merged = mergeOnRegenerate(prev, fresh);
    expect(merged.map((p) => p.original.titulo)).toEqual(["x", "nueva"]);
  });
});

describe("lo editado y el historial", () => {
  it("lo editado gana y el diff dice qué cambió", () => {
    const p: Proposal = { id: "a", type: "tarea", status: "pending", original: { titulo: "x", detalle: "d", vence_en_dias: 2 }, edited: { titulo: "x2", detalle: "d", vence_en_dias: 5 }, result: null };
    expect(effectiveProposal(p)).toMatchObject({ titulo: "x2", vence_en_dias: 5 });
    expect(proposalDiff(p.original, p.edited)).toEqual({ titulo: { old: "x", new: "x2" }, vence_en_dias: { old: 2, new: 5 } });
  });
});

describe("instrucciones", () => {
  it("sin contacto no ofrece mensaje; con pasos pendientes ofrece paso y los lista", () => {
    const sin = buildProposalsInstructions({ service: null, hasContact: false, clientMessage: true });
    expect(sin).not.toMatch(/- mensaje:/);
    const con = buildProposalsInstructions({ service: { product: "Mentoría", variant: "Anual", phase: "Inicio", pendingItems: [{ key: "it_abc123", name: "Configurar" }] }, hasContact: true, clientMessage: true });
    expect(con).toMatch(/- paso:/);
    expect(con).toMatch(/it_abc123: Configurar/);
    expect(con).toMatch(/Siempre incluí UNA acción de tipo mensaje/);
  });
});

describe("la cita obligatoria (traída de RER)", () => {
  const T = "Cliente: mandame el contrato firmado mañana y avisale a contabilidad que ya pagué.";
  const ctx = { hasContact: true, pendingItemKeys: [], clientMessage: false, transcriptText: T };
  it("una tarea o un aviso sin una cita que esté en la transcripción no se propone", () => {
    const out = normalizeProposals([act({ cita: "mandame el contrato firmado" }), act({ cita: "esto no lo dijo nadie" }), act({ cita: null }), act({ tipo: "aviso", titulo: "Pagó", cita: "ya pagué" })], ctx, id);
    expect(out.map((p) => [p.type, p.original.cita])).toEqual([["tarea", "mandame el contrato firmado"], ["aviso", "ya pagué"]]);
  });
  it("el mensaje para el cliente es un resumen: no necesita cita", () => {
    expect(normalizeProposals([act({ tipo: "mensaje", texto: "Hola, te resumo", cita: null })], ctx, id)).toHaveLength(1);
  });
  it("las instrucciones piden la cita textual", () => {
    expect(buildProposalsInstructions({ service: null, hasContact: true, clientMessage: false })).toMatch(/`cita`.*TEXTUAL/);
  });
});

describe("regenerar por origen", () => {
  const prev: Proposal[] = [
    { id: "t", type: "tarea", status: "pending", original: { titulo: "tarea", detalle: "" }, edited: null, result: null },
    { id: "i", type: "idea", status: "pending", original: { titulo: "idea", detalle: "" }, edited: null, result: null },
    { id: "d", type: "borrador", status: "done", original: { titulo: "borrador", detalle: "" }, edited: null, result: null },
  ];
  it("el análisis reemplaza solo las suyas: las ideas pendientes quedan", () => {
    expect(mergeOnRegenerate(prev, []).map((p) => p.id)).toEqual(["i", "d"]);
  });
  it("el resumen reemplaza solo las de contenido: las tareas pendientes quedan", () => {
    expect(mergeOnRegenerate(prev, [], ["idea", "borrador"]).map((p) => p.id)).toEqual(["t", "d"]);
  });
  it("la 00450 hace lo mismo con la reunión bloqueada y solo la llama el servidor", () => {
    const sql = readFileSync("supabase/migrations/00450_call_proposals_replace_pending.sql", "utf8");
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/status' = 'pending' AND \(o\.elem ->> 'type'\) = ANY \(p_types\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.call_proposals_replace_pending\(uuid, text\[\], jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/TO service_role;/);
  });
});

describe("quién aprueba", () => {
  it("por defecto: lo del cliente el responsable; el contenido, un admin", () => {
    expect(DEFAULT_PROPOSAL_APPROVERS).toEqual({ tarea: "responsable", mensaje: "responsable", paso: "responsable", aviso: "responsable", idea: "admin", borrador: "admin" });
  });
  it("lo que falta o tiene un valor raro vale el de por defecto", () => {
    expect(normalizeApprovers({ tarea: "admin", idea: "cualquiera", otra: "admin" })).toEqual({ ...DEFAULT_PROPOSAL_APPROVERS, tarea: "admin" });
    expect(normalizeApprovers(null)).toEqual(DEFAULT_PROPOSAL_APPROVERS);
  });
  it("un admin decide todo; el responsable solo lo que le toca; nadie más", () => {
    expect(canDecideProposal({ approver: "admin", isAdmin: true, isResponsible: false })).toBe(true);
    expect(canDecideProposal({ approver: "responsable", isAdmin: false, isResponsible: true })).toBe(true);
    expect(canDecideProposal({ approver: "admin", isAdmin: false, isResponsible: true })).toBe(false);
    expect(canDecideProposal({ approver: "responsable", isAdmin: false, isResponsible: false })).toBe(false);
  });
  it("el responsable es el del servicio; sin servicio, quien grabó", () => {
    expect(responsibleFor({ serviceOwnerId: "u1", recordedBy: "u2" })).toBe("u1");
    expect(responsibleFor({ serviceOwnerId: null, recordedBy: "u2" })).toBe("u2");
  });
});

describe("motivo al descartar", () => {
  it("sin motivo, «No hace falta»; «Otro» pide nota; un motivo raro no pasa", () => {
    expect(parseDiscard(undefined, undefined)).toEqual({ ok: true, reason: "no_hace_falta", note: null });
    expect(parseDiscard("otro", "  ")).toMatchObject({ ok: false });
    expect(parseDiscard("otro", "ya estaba hecho")).toEqual({ ok: true, reason: "otro", note: "ya estaba hecho" });
    expect(parseDiscard("tono", null)).toMatchObject({ ok: false });
    expect(parseDiscard("dato_incorrecto", "x".repeat(501))).toMatchObject({ ok: false });
  });
});
