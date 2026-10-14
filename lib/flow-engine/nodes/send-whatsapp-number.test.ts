/**
 * D3: «Enviar WhatsApp a un número». Evolution está simulado (nada sale de verdad). Se prueba el contrato del paso: el
 * número fijo y el de una variable, lo que se saltea con su motivo (variable vacía, número inválido, sin canal, contacto
 * «no contactar», tope por hora), el envío a un número desconocido sin crear nada, el envío a un contacto con conversación
 * (queda guardado ahí) y que un mismo paso en la misma sesión nunca mande dos veces al mismo número.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import type { FlowExecutionContext } from "../types";

const sendText = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ id: "wamid-1" })));
vi.mock("@/lib/evolution-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/evolution-client")>("@/lib/evolution-client");
  return { ...actual, sendText, sendMedia: vi.fn(async () => ({ id: "wamid-media" })), sendWhatsAppAudio: vi.fn(async () => ({ id: "wamid-audio" })) };
});
const evolutionConfig = vi.hoisted(() => ({ value: { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "t" } as { baseUrl: string; apiKey: string; instancePrefix: string } | null }));
vi.mock("@/lib/evolution-config", () => ({ getEvolutionConfig: vi.fn(async () => evolutionConfig.value) }));

const { sendWhatsAppNumberNode, resolveWhatsAppTarget, WHATSAPP_NUMBER_HOURLY_LIMIT } = await import("./send-whatsapp-number");

const WS = "ws-1";
const CH = "ch-wa";

let allowSend = true;
let db: MemoryDb;
let skipped: string[] = [];

function world(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  allowSend = true;
  return memoryDb(
    {
      channels: [
        { id: CH, workspace_id: WS, provider: "evolution", platform: "whatsapp", evolution_instance: "inst-1", late_account_id: null, email_address: null, is_active: true },
        { id: "ch-ig", workspace_id: WS, provider: "zernio", platform: "instagram", evolution_instance: null, late_account_id: "acc", email_address: null, is_active: true },
        { id: "ch-otro", workspace_id: "ws-otro", provider: "evolution", platform: "whatsapp", evolution_instance: "inst-x", late_account_id: null, email_address: null, is_active: true },
      ],
      contacts: [
        { id: "c-ana", workspace_id: WS, phone: "+5491122334455", do_not_contact: false },
        { id: "c-dnc", workspace_id: WS, phone: "+5491199998888", do_not_contact: true },
        { id: "c-sinconv", workspace_id: WS, phone: "+5491100001111", do_not_contact: false },
      ],
      conversations: [{ id: "conv-ana", workspace_id: WS, channel_id: CH, contact_id: "c-ana" }],
      contact_channels: [{ channel_id: CH, contact_id: "c-ana", platform_sender_id: "5491122334455@s.whatsapp.net" }],
      flow_send_claims: [],
      analytics_events: [],
      messages: [],
      ...extra,
    },
    {
      unique: { flow_send_claims: (a, b) => a.session_id === b.session_id && a.node_id === b.node_id && a.target === b.target },
      rpc: {
        // La función única de contactos en modo `find_only`: solo busca por teléfono.
        find_or_create_contact: (args, d) => {
          const identity = (args.p_identity ?? {}) as { phone?: string };
          const found = d.rows("contacts").find((c) => c.phone === identity.phone && c.workspace_id === args.p_workspace_id);
          if (args.p_mode !== "find_only") throw new Error("este paso nunca crea contactos");
          return { contact_id: found?.id ?? null, created: false, matched_by: found ? "phone" : null, conflicts: [], status: found ? "found" : "not_found" };
        },
        claim_automated_send: () => allowSend,
      },
    },
  );
}

const ctx = (over: Partial<FlowExecutionContext> = {}): FlowExecutionContext => ({
  triggerId: "t",
  flowId: "flow-1",
  channelId: "",
  contactId: null,
  conversationId: "",
  workspaceId: WS,
  incomingMessage: {},
  variables: { webhook: { body: { telefono: "+54 9 11 5555-0000", nombre: "Lead Nuevo" } } },
  onStepSkipped: (s) => skipped.push(s.label),
  ...over,
});

const run = (data: Parameters<typeof sendWhatsAppNumberNode.execute>[0]["data"], context = ctx(), sessionId = "sess-1", nodeId = "n1") =>
  sendWhatsAppNumberNode.execute({
    supabase: db.client,
    node: { id: nodeId, type: "action", position: { x: 0, y: 0 }, data: { label: "Avisar a Wendy" } } as never,
    data,
    context,
    sessionId,
    runtime: { executeFlow: async () => {} },
  } as never);

const events = (type: string) => db.rows("analytics_events").filter((e) => e.event_type === type);

beforeEach(() => {
  sendText.mockClear();
  evolutionConfig.value = { baseUrl: "https://evo.test", apiKey: "k", instancePrefix: "t" };
  skipped = [];
  db = world();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveWhatsAppTarget (puro)", () => {
  it("un número fijo se normaliza", () => {
    expect(resolveWhatsAppTarget({ to: "fixed", fixedPhone: "+54 9 11 2233-4455" }, {})).toEqual({ ok: true, phone: "+5491122334455" });
    expect(resolveWhatsAppTarget({ fixedPhone: "0054 9 11 2233 4455" }, {})).toEqual({ ok: true, phone: "+5491122334455" });
  });
  it("el número de una variable, con o sin llaves", () => {
    const vars = { webhook: { body: { telefono: "(+57) 300 123 4567" } } };
    expect(resolveWhatsAppTarget({ to: "variable", toVariable: "{{webhook.body.telefono}}" }, vars)).toEqual({ ok: true, phone: "+573001234567" });
    expect(resolveWhatsAppTarget({ to: "variable", toVariable: "webhook.body.telefono" }, vars)).toEqual({ ok: true, phone: "+573001234567" });
  });
  it("variable vacía, sin elegir, número inválido o corto: se rechaza con el motivo", () => {
    expect(resolveWhatsAppTarget({ to: "variable", toVariable: "{{webhook.body.nada}}" }, {})).toMatchObject({ ok: false, reason: expect.stringContaining("no existe o está vacía") });
    expect(resolveWhatsAppTarget({ to: "variable", toVariable: "" }, {})).toMatchObject({ ok: false });
    expect(resolveWhatsAppTarget({ to: "fixed", fixedPhone: "" }, {})).toMatchObject({ ok: false, reason: expect.stringContaining("Falta") });
    expect(resolveWhatsAppTarget({ to: "fixed", fixedPhone: "12345" }, {})).toMatchObject({ ok: false, reason: expect.stringContaining("no es válido") });
    expect(resolveWhatsAppTarget({ to: "fixed", fixedPhone: "hola" }, {})).toMatchObject({ ok: false });
  });
});

describe("Enviar WhatsApp a un número", () => {
  it("no necesita contacto y se reconoce por su alias de acción", () => {
    expect(sendWhatsAppNumberNode.needsContact).toBe(false);
    expect(sendWhatsAppNumberNode.aliases).toEqual([{ nodeType: "action", actionType: "send_whatsapp_number" }]);
  });

  it("a un número fijo que no es de nadie: manda con Evolution, sin crear contacto ni conversación, y queda en el historial", async () => {
    await run({ to: "fixed", fixedPhone: "+54 9 11 7777-0000", channelId: CH, text: "Nuevo lead: {{webhook.body.nombre}}" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0].slice(1)).toEqual(["inst-1", "+5491177770000", "Nuevo lead: Lead Nuevo"]);
    expect(db.rows("contacts")).toHaveLength(3); // no se creó nadie
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("messages")).toHaveLength(0);
    expect(events("whatsapp_number_sent")).toEqual([
      expect.objectContaining({ workspace_id: WS, flow_id: "flow-1", contact_id: null, metadata: expect.objectContaining({ nodeId: "n1", to: "+5491177770000", text: "Nuevo lead: Lead Nuevo", result: "sent" }) }),
    ]);
  });

  it("el número de una variable", async () => {
    await run({ to: "variable", toVariable: "{{webhook.body.telefono}}", channelId: CH, text: "Hola" });
    expect(sendText.mock.calls[0].slice(2, 3)).toEqual(["+5491155550000"]);
  });

  it("variable vacía: se saltea con el motivo, avisa y no manda", async () => {
    await run({ to: "variable", toVariable: "{{webhook.body.no_existe}}", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ nodeId: "n1", nodeType: "send_whatsapp_number", reason: expect.stringContaining("no existe o está vacía") }) })]);
    expect(skipped).toEqual(["Avisar a Wendy"]);
    expect(db.rows("flow_send_claims")).toHaveLength(0);
  });

  it("número inválido: se saltea con el motivo", async () => {
    await run({ to: "fixed", fixedPhone: "123", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")[0].metadata).toMatchObject({ reason: expect.stringContaining("no es válido") });
  });

  it("sin canal, con un canal que no es de WhatsApp o de otro workspace: se saltea", async () => {
    for (const channelId of [undefined, "ch-ig", "ch-otro", "no-existe"]) {
      db = world();
      skipped = [];
      await run({ to: "fixed", fixedPhone: "+5491177770000", channelId, text: "Hola" });
      expect(sendText).not.toHaveBeenCalled();
      expect(events("node_skipped"), String(channelId)).toHaveLength(1);
      expect(skipped).toHaveLength(1);
    }
  });

  it("un canal de WhatsApp desconectado se saltea", async () => {
    db.rows("channels").find((c) => c.id === CH)!.is_active = false;
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")).toHaveLength(1);
  });

  it("mensaje vacío: se saltea", async () => {
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "   " });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")[0].metadata).toMatchObject({ reason: expect.stringContaining("vacío") });
  });

  it("el número de un contacto marcado «no contactar»: no se manda y queda anotado", async () => {
    await run({ to: "fixed", fixedPhone: "+54 9 11 9999-8888", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")[0]).toMatchObject({ contact_id: "c-dnc", metadata: expect.objectContaining({ reason: expect.stringContaining("no contactar") }) });
  });

  it("el número de un contacto con conversación en ese canal: el mensaje queda guardado en su conversación", async () => {
    await run({ to: "fixed", fixedPhone: "+5491122334455", channelId: CH, text: "Hola Ana" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(db.rows("messages")).toEqual([expect.objectContaining({ conversation_id: "conv-ana", direction: "outbound", text: "Hola Ana", status: "sent", sent_by_flow_id: "flow-1", sent_by_node_id: "n1" })]);
    expect(events("whatsapp_number_sent")[0]).toMatchObject({ contact_id: "c-ana" });
    expect(db.rows("conversations")).toHaveLength(1);
  });

  it("un contacto sin conversación en ese canal: se manda directo y no se crea una conversación", async () => {
    await run({ to: "fixed", fixedPhone: "+5491100001111", channelId: CH, text: "Hola" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(db.rows("conversations")).toHaveLength(1);
    expect(db.rows("messages")).toHaveLength(0);
    expect(events("whatsapp_number_sent")[0]).toMatchObject({ contact_id: "c-sinconv" });
  });

  it("nunca dos veces: el mismo paso, en la misma sesión y al mismo número, manda una sola", async () => {
    const data = { to: "fixed" as const, fixedPhone: "+5491177770000", channelId: CH, text: "Hola" };
    await run(data);
    await run(data);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(events("node_skipped")[0].metadata).toMatchObject({ duplicate: true });
    expect(db.rows("flow_send_claims")).toHaveLength(1);
  });

  it("otra sesión, otro paso u otro número SÍ mandan", async () => {
    const data = { to: "fixed" as const, fixedPhone: "+5491177770000", channelId: CH, text: "Hola" };
    await run(data, ctx(), "sess-1", "n1");
    await run(data, ctx(), "sess-2", "n1");
    await run(data, ctx(), "sess-1", "n2");
    await run({ ...data, fixedPhone: "+5491177771111" }, ctx(), "sess-1", "n1");
    expect(sendText).toHaveBeenCalledTimes(4);
  });

  it("el tope por hora del canal: sin lugar no se manda y queda anotado", async () => {
    allowSend = false;
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")[0].metadata).toMatchObject({ rate_limited: true });
    const call = db.rpcCalls.find((c) => c.name === "claim_automated_send");
    expect(call?.args).toEqual({ p_channel_id: CH, p_limit: WHATSAPP_NUMBER_HOURLY_LIMIT });
    expect(WHATSAPP_NUMBER_HOURLY_LIMIT).toBe(200);
  });

  it("si Evolution rechaza el envío, no lanza: queda anotado como fallido", async () => {
    sendText.mockRejectedValueOnce(new Error("instance closed"));
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    expect(events("whatsapp_number_failed")).toHaveLength(1);
    expect(events("whatsapp_number_sent")).toHaveLength(0);
  });

  it("sin configuración de WhatsApp en el entorno, se saltea", async () => {
    evolutionConfig.value = null;
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")).toHaveLength(1);
  });

  it("un error de la base al buscar el contacto NO se toma como «no es de nadie»: no se manda", async () => {
    db = memoryDb({ channels: db.rows("channels"), flow_send_claims: [], analytics_events: [] }, { rpc: { find_or_create_contact: () => { throw new Error("db caida"); }, claim_automated_send: () => true } });
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    expect(sendText).not.toHaveBeenCalled();
    expect(events("node_skipped")[0].metadata).toMatchObject({ reason: expect.stringContaining("No pude comprobar") });
  });

  it("nunca crea contactos: solo usa la búsqueda find_only", async () => {
    await run({ to: "fixed", fixedPhone: "+5491177770000", channelId: CH, text: "Hola" });
    const modes = db.rpcCalls.filter((c) => c.name === "find_or_create_contact").map((c) => c.args.p_mode);
    expect(modes).toEqual(["find_only"]);
  });
});
