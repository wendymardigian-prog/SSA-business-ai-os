/**
 * Publicar un flujo de webhook (Extra L, F10): el editor no deja publicar un paso que necesita un
 * contacto si en algún camino no está antes «Crear o actualizar contacto». Un flujo que no es de
 * webhook se publica como siempre (no-regresión).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { createClient, createServiceClient } = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient, createServiceClient }));
// Quien publica tiene `flows.publish` (Equipo y roles, F22); el guard en si se prueba en lib/flow-engine/api-permissions.test.ts.
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: vi.fn(async () => ({ user: { id: "u-1" } })) }));
// El workspace ACTIVO de la sesion (lib/workspace.ts): las rutas ya no buscan "el primero" por su cuenta.
vi.mock("@/lib/workspace", () => ({ getActiveWorkspace: async () => ({ workspace: { id: "ws-1" } }) }));
vi.mock("@/lib/sales/automation/relative", () => ({ backfillPaymentRelativeJobs: vi.fn(async () => {}) })); // @plantilla-quitar(ventas)

import { POST } from "./route";

const WS = "ws-1";
// Una palabra clave necesita al menos una palabra para publicarse (auditoria de automatizaciones).
const trigger = (triggerType: string) => ({ id: "t", type: "trigger", data: { triggerType, ...(triggerType === "keyword" ? { keywords: [{ value: "hola", matchType: "contains" }] } : {}) } });
const whatsapp = { id: "m", type: "sendMessage", data: { label: "Enviar WhatsApp", messages: [] } };
const upsert = { id: "u", type: "upsert_contact", data: {} };

const ACTIVE_CHANNEL = { id: "ch-1", workspace_id: WS, platform: "instagram", provider: "zernio", evolution_instance: null, is_active: true };
const RESEND = { workspace_id: WS, type: "email_provider", provider: "resend", is_active: true };

function setup(nodes: unknown[], edges: unknown[], extra: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({
    // Con un canal conectado: «Enviar WhatsApp» (un sendMessage) necesita al menos uno (G1).
    channels: [ACTIVE_CHANNEL],
    integration_configs: [],
    agents: [],
    ...extra,
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

describe("POST /api/v1/flows/[flowId]/publish: una accion sin su conexion no se publica (G1)", () => {
  const email = { id: "e", type: "action", data: { actionType: "send_email", label: "Aviso por email", to: "fixed", fixedEmail: "a@b.com", subject: "x", body: "y" } };
  const edges = [{ id: "e1", source: "t", target: "e" }];

  it("«Enviar email» sin Resend conectado: rechaza, dice que falta y no publica (el borrador queda intacto)", async () => {
    const db = setup([trigger("keyword"), email], edges);
    const res = await publish();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("«Aviso por email» no se va a poder ejecutar");
    expect(body.error).toContain("Email saliente (Resend)");
    expect(body.problems).toHaveLength(1);
    expect(db.rows("flows")[0].status).toBe("draft");
    expect(db.rows("flow_versions")).toHaveLength(0);
  });

  it("al conectar Resend, el MISMO flujo se publica sin tocarlo", async () => {
    const db = setup([trigger("keyword"), email], edges, { integration_configs: [RESEND] });
    expect((await publish()).status).toBe(200);
    expect(db.rows("flows")[0].status).toBe("published");
  });

  it("sin ningun canal, un mensaje tampoco se publica", async () => {
    const db = setup([trigger("keyword"), whatsapp], [{ id: "e1", source: "t", target: "m" }], { channels: [] });
    expect((await publish()).status).toBe(400);
    expect(db.rows("flows")[0].status).toBe("draft");
  });

  it("un paso bloqueado que no se alcanza desde el disparador no frena la publicacion", async () => {
    // El disparador necesita un paso conectado; el email suelto, sin Resend, no se alcanza y no frena nada.
    const db = setup([trigger("keyword"), whatsapp, email], [{ id: "e1", source: "t", target: "m" }]);
    expect((await publish()).status).toBe(200);
    expect(db.rows("flows")[0].status).toBe("published");
  });

  it("devuelve TODOS los problemas, no solo el primero", async () => {
    const ai = { id: "a", type: "aiResponse", data: {} };
    const db = setup([trigger("keyword"), email, ai], [{ id: "e1", source: "t", target: "e" }, { id: "e2", source: "e", target: "a" }]);
    const res = await publish();
    expect(res.status).toBe(400);
    expect((await res.json()).problems).toHaveLength(2);
    expect(db.rows("flows")[0].status).toBe("draft");
  });
});
