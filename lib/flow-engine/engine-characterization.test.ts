/**
 * Caracterizacion del arranque de un flow ANTES de la Etapa 4.
 *
 * Lo que fija: `executeFlow` crea la sesion con el `channelId` que le dieron,
 * tal cual, incluso vacio. Contra la base real, `flow_sessions.channel_id` es
 * NOT NULL con FK a `channels`, asi que un `""` hace fallar el insert y el
 * flow termina sin correr y sin avisar. B7a lo cambia (columna nullable y
 * motor que tolera un flow sin canal); este test documenta el punto de
 * partida y se actualiza junto con ese cambio.
 */
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { executeFlow } from "./engine";

const WS = "ws-1";

function world(channelId: string) {
  const db = memoryDb({
    flows: [
      {
        id: "flow-1",
        workspace_id: WS,
        status: "published",
        nodes: [{ id: "n-trigger", type: "trigger", data: { triggerType: "keyword" } }],
        edges: [],
      },
    ],
    channels: [{ id: "ch-1", platform: "whatsapp", late_account_id: null }],
    conversations: [],
    flow_sessions: [],
    analytics_events: [],
  });
  const context = {
    triggerId: "tr-1",
    flowId: "flow-1",
    channelId,
    contactId: "c-1",
    conversationId: "",
    workspaceId: WS,
    incomingMessage: {},
    variables: { event_type: "tag_added" },
  };
  return { db, context };
}

describe("executeFlow (canal opcional desde la 00100)", () => {
  it("con canal, crea la sesion y registra flow_started", async () => {
    const { db, context } = world("ch-1");
    await executeFlow(db.client, context);
    expect(db.rows("flow_sessions")).toHaveLength(1);
    expect(db.rows("flow_sessions")[0]).toMatchObject({ contact_id: "c-1", flow_id: "flow-1", channel_id: "ch-1", status: "active", variables: { event_type: "tag_added" } });
    expect(db.rows("analytics_events").map((e) => e.event_type)).toEqual(["flow_started"]);
  });

  it("sin canal (contacto sin conversacion), la sesion se crea con channel_id null", async () => {
    const { db, context } = world("");
    await executeFlow(db.client, context);
    // ANTES de la 00100 el motor mandaba "" y Postgres lo rechazaba por NOT
    // NULL y por la clave foranea: el flow no corria y nadie se enteraba. Un
    // lead que agenda desde la pagina publica no tiene conversacion, asi que
    // sin esto ningun flujo de agenda arrancaria.
    expect(db.rows("flow_sessions")[0]).toMatchObject({ channel_id: null, status: "active" });
    expect(db.rows("analytics_events").map((e) => e.event_type)).toEqual(["flow_started"]);
  });

  it("si el insert de la sesion falla, no registra flow_started ni recorre nodos", async () => {
    const { db, context } = world("");
    // Simula el rechazo de la base con un unico que choca contra si mismo.
    const failing = memoryDb({ ...db.tables, flow_sessions: [{ contact_id: "c-1", flow_id: "flow-1", channel_id: null }] }, { unique: { flow_sessions: (a, b) => a.channel_id === b.channel_id && a.contact_id === b.contact_id } });
    await executeFlow(failing.client, context);
    expect(failing.rows("analytics_events")).toHaveLength(0);
  });
});
