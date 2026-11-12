import { describe, expect, it } from "vitest";
import {
  buildProposalsInstructions,
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
