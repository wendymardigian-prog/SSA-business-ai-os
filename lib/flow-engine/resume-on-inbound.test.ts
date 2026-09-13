import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Regresion del bug de la sesion dormida (Fase 3, Bloque 2a).
 *
 * Antes, una conversacion parada en "Esperar respuesta" solo se retomaba si el
 * mensaje entrante matcheaba ALGUN trigger: el chequeo de la sesion en espera
 * vivia adentro de executeFlow, que solo se llamaba despues del matcher. Con el
 * agente de IA encendido, esos mensajes se los hubiera llevado el agente.
 *
 * Este test usa el motor REAL (no un mock de executeFlow): lo que se afirma no
 * es solo que el agente no se lleve el mensaje, sino que el flow efectivamente
 * avanza al nodo que sigue a la espera.
 */

const matchTrigger = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flow-engine/trigger-matcher", () => ({ matchTrigger }));

import { runInboundAutomation } from "@/lib/inbound";
import { registerNode } from "./registry";

// Un nodo de prueba que solo anota que se ejecuto.
const executedMarkers: string[] = [];
registerNode({
  type: "zzResumeMarker",
  label: "Marcador de prueba",
  execute: ({ node, context }) => {
    executedMarkers.push(`${node.id}:${context.variables?.message ?? ""}`);
  },
});

const FLOW = {
  id: "flow-espera",
  workspace_id: "ws-1",
  status: "published",
  nodes: [
    { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: {} },
    { id: "espera", type: "smartDelay", position: { x: 0, y: 0 }, data: {} },
    { id: "despues", type: "zzResumeMarker", position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: "e1", source: "t", target: "espera" },
    { id: "e2", source: "espera", target: "despues" },
  ],
};

const WAITING_SESSION = {
  id: "ses-1",
  flow_id: FLOW.id,
  contact_id: "c-1",
  channel_id: "ch-1",
  status: "active",
  current_node_id: "espera",
  waiting_for_input: true,
  waiting_until: null,
  variables: {},
};

function fakeDb(waiting: typeof WAITING_SESSION | null) {
  const sessionUpdates: Array<Record<string, unknown>> = [];
  const insertedSessions: unknown[] = [];

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ["select", "eq", "is", "order", "limit", "in", "neq"]) builder[m] = chain;
    builder.update = (values: Record<string, unknown>) => {
      if (table === "flow_sessions") sessionUpdates.push(values);
      return builder;
    };
    builder.insert = (values: unknown) => {
      if (table === "flow_sessions") insertedSessions.push(values);
      return builder;
    };
    builder.maybeSingle = async () => ({
      data: table === "flow_sessions" ? waiting : null,
      error: null,
    });
    builder.single = async () => {
      if (table === "workspaces") return { data: { global_keywords: [] }, error: null };
      if (table === "flows") return { data: FLOW, error: null };
      if (table === "channels") return { data: { platform: "instagram", late_account_id: "la-1" }, error: null };
      if (table === "flow_sessions") return { data: { flow_id: FLOW.id, contact_id: "c-1", channel_id: "ch-1" }, error: null };
      return { data: null, error: null };
    };
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
    return builder;
  };

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    sessionUpdates,
    insertedSessions,
  };
}

const BASE = {
  channel: { id: "ch-1", workspace_id: "ws-1" },
  contactId: "c-1",
  conversationId: "cv-1",
  isAutomationPaused: false,
  isFirstMessage: false,
};

beforeEach(() => {
  executedMarkers.length = 0;
  matchTrigger.mockReset();
});

describe("una conversacion parada en 'Esperar respuesta'", () => {
  it("se retoma con el mensaje aunque NINGUN trigger lo matchee, y el flow avanza al nodo siguiente", async () => {
    matchTrigger.mockResolvedValue(null);
    const { client, sessionUpdates, insertedSessions } = fakeDb(WAITING_SESSION);

    await runInboundAutomation({
      supabase: client,
      ...BASE,
      incomingMessage: { text: "si, me interesa" },
    });

    // El flow efectivamente siguio: el nodo despues de la espera corrio, con
    // el mensaje de la respuesta disponible como {{message}}.
    expect(executedMarkers).toEqual(["despues:si, me interesa"]);
    // La sesion dejo de esperar y se completo.
    expect(sessionUpdates).toContainEqual(expect.objectContaining({ waiting_for_input: false }));
    expect(sessionUpdates).toContainEqual(expect.objectContaining({ status: "completed" }));
    // No se arranco un flow nuevo ni se consulto el matcher.
    expect(insertedSessions).toHaveLength(0);
    expect(matchTrigger).not.toHaveBeenCalled();
  });

  it("tambien gana sobre un trigger que SI matchea: se retoma lo que estaba esperando", async () => {
    matchTrigger.mockResolvedValue({ id: "tr-otro", flow_id: "flow-otro" });
    const { client, insertedSessions } = fakeDb(WAITING_SESSION);

    await runInboundAutomation({ supabase: client, ...BASE, incomingMessage: { text: "hola" } });

    expect(executedMarkers).toEqual(["despues:hola"]);
    expect(insertedSessions).toHaveLength(0);
  });

  it("sin sesion en espera, el camino de siempre: se buscan triggers", async () => {
    matchTrigger.mockResolvedValue(null);
    const { client } = fakeDb(null);

    await runInboundAutomation({ supabase: client, ...BASE, incomingMessage: { text: "hola" } });

    expect(matchTrigger).toHaveBeenCalledTimes(1);
    expect(executedMarkers).toHaveLength(0);
  });

  it("una conversacion tomada a mano no se retoma: el bot no se mete", async () => {
    const { client } = fakeDb(WAITING_SESSION);

    await runInboundAutomation({
      supabase: client,
      ...BASE,
      isAutomationPaused: true,
      incomingMessage: { text: "hola" },
    });

    expect(executedMarkers).toHaveLength(0);
  });
});
