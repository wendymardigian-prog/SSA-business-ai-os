/**
 * Publicar un flujo de webhook (Extra L, F10): el editor no deja publicar un paso que necesita un
 * contacto si en algún camino no está antes «Crear o actualizar contacto». Un flujo que no es de
 * webhook se publica como siempre (no-regresión).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { createClient, createServiceClient } = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient, createServiceClient }));
vi.mock("@/lib/sales/automation/relative", () => ({ backfillPaymentRelativeJobs: vi.fn(async () => {}) }));

import { POST } from "./route";

const WS = "ws-1";
const trigger = (triggerType: string) => ({ id: "t", type: "trigger", data: { triggerType } });
const whatsapp = { id: "m", type: "sendMessage", data: { label: "Enviar WhatsApp", messages: [] } };
const upsert = { id: "u", type: "upsert_contact", data: {} };

function setup(nodes: unknown[], edges: unknown[]) {
  const db = memoryDb({
    workspace_members: [{ user_id: "u-1", workspace_id: WS }],
    flows: [{ id: "f-1", workspace_id: WS, version: 0, status: "draft", name: "Flujo", nodes, edges, viewport: null }],
    flow_versions: [],
    triggers: [],
  });
  const client = Object.assign(Object.create(db.client), { auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) } });
  createClient.mockResolvedValue(client);
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const publish = () => POST({} as never, { params: Promise.resolve({ flowId: "f-1" }) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/v1/flows/[flowId]/publish con el disparador de webhook", () => {
  it("«Enviar WhatsApp» antes de «Crear o actualizar contacto»: rechaza y no publica", async () => {
    const db = setup(
      [trigger("webhook_received"), whatsapp, upsert],
      [{ id: "e1", source: "t", target: "m" }, { id: "e2", source: "m", target: "u" }],
    );
    const res = await publish();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("«Enviar WhatsApp» necesita un contacto");
    expect(db.rows("flows")[0].status).toBe("draft");
    expect(db.rows("flow_versions")).toHaveLength(0);
  });

  it("el mismo paso colgado de la salida «No se pudo»: rechaza", async () => {
    const db = setup(
      [trigger("webhook_received"), upsert, whatsapp],
      [{ id: "e1", source: "t", target: "u" }, { id: "e2", source: "u", sourceHandle: "fail", target: "m" }],
    );
    expect((await publish()).status).toBe(400);
    expect(db.rows("flows")[0].status).toBe("draft");
  });

  it("después del paso de contacto, por «Listo»: publica", async () => {
    const db = setup(
      [trigger("webhook_received"), upsert, whatsapp],
      [{ id: "e1", source: "t", target: "u" }, { id: "e2", source: "u", sourceHandle: "ok", target: "m" }],
    );
    const res = await publish();
    expect(res.status).toBe(200);
    expect(db.rows("flows")[0].status).toBe("published");
  });

  it("un flujo con otro disparador no exige el paso de contacto (no-regresión)", async () => {
    const db = setup([trigger("keyword"), whatsapp], [{ id: "e1", source: "t", target: "m" }]);
    expect((await publish()).status).toBe(200);
    expect(db.rows("flows")[0].status).toBe("published");
  });
});
