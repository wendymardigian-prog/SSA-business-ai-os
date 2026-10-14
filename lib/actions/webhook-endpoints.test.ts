import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { getPermissionAction, createServiceClient } = vi.hoisted(() => ({
  getPermissionAction: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/vault", () => ({ storeSecret: vi.fn(async () => ({ ok: true })), deleteSecret: vi.fn(async () => ({ ok: true })) }));

import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  generateWebhookSecret,
  regenerateWebhookToken,
  reprocessWebhookInbounds,
  saveWebhookSampleFromJson,
  setWebhookEndpointStatus,
  startWebhookListening,
  updateWebhookEndpoint,
} from "./webhook-endpoints";

const WS = "ws-1";
const OTHER = "ws-2";

function world(extra: Record<string, Record<string, unknown>[]> = {}) {
  const db = memoryDb({
    webhook_endpoints: [
      { id: "ep-1", workspace_id: WS, name: "Typeform", token: "A".repeat(22), status: "active", secret_vault_name: null, listen_until: null, deleted_at: null, created_by: "u-1" },
      { id: "ep-x", workspace_id: OTHER, name: "Ajeno", token: "B".repeat(22), status: "active", secret_vault_name: null, listen_until: null, deleted_at: null, created_by: "u-9" },
    ],
    inbound_webhooks: [],
    triggers: [],
    audit_log: [],
    ...extra,
  });
  createServiceClient.mockResolvedValue(db.client);
  return db;
}

const allowed = () => getPermissionAction.mockResolvedValue({ workspace: { id: WS }, user: { id: "u-1" }, can: () => true });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sin webhooks.manage todo se rechaza y no se toca la base", () => {
  it.each([
    ["crear", () => createWebhookEndpoint({ name: "x" })],
    ["editar", () => updateWebhookEndpoint("ep-1", { name: "x" })],
    ["pausar", () => setWebhookEndpointStatus("ep-1", "paused")],
    ["regenerar la URL", () => regenerateWebhookToken("ep-1")],
    ["generar el secreto", () => generateWebhookSecret("ep-1")],
    ["borrar", () => deleteWebhookEndpoint("ep-1")],
    ["escuchar", () => startWebhookListening("ep-1")],
    ["pegar un ejemplo", () => saveWebhookSampleFromJson("ep-1", "{}")],
    ["reprocesar", () => reprocessWebhookInbounds([{ id: "in-1", reprocessCount: 0 }])],
  ])("%s", async (_name, run) => {
    const db = world();
    getPermissionAction.mockResolvedValue(null);
    const res = await run();
    expect(res.ok).toBe(false);
    expect(getPermissionAction).toHaveBeenCalledWith("webhooks.manage");
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(db.rows("webhook_endpoints")).toHaveLength(2);
    expect(db.rows("audit_log")).toHaveLength(0);
  });
});

describe("con permiso", () => {
  it("crear genera un token de 22 caracteres URL-safe, con el workspace de la sesion", async () => {
    const db = world();
    allowed();
    const res = await createWebhookEndpoint({ name: "  Tally  ", description: "Formulario de la landing", eventIdPath: "event_id" });
    expect(res.ok).toBe(true);
    const created = db.rows("webhook_endpoints").find((r) => r.name === "Tally")!;
    expect(created).toBeTruthy();
    expect(String(created.token)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created).toMatchObject({ workspace_id: WS, created_by: "u-1", event_id_path: "event_id" });
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "webhook_endpoint", action: "webhook_endpoint.created" });
  });

  it("un nombre vacío se rechaza antes de escribir", async () => {
    const db = world();
    allowed();
    expect((await createWebhookEndpoint({ name: "  " })).ok).toBe(false);
    expect(db.rows("webhook_endpoints")).toHaveLength(2);
  });

  it("regenerar cambia el token; el viejo ya no sirve", async () => {
    const db = world();
    allowed();
    expect((await regenerateWebhookToken("ep-1")).ok).toBe(true);
    const token = String(db.rows("webhook_endpoints").find((r) => r.id === "ep-1")!.token);
    expect(token).not.toBe("A".repeat(22));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(db.rows("audit_log")[0].action).toBe("webhook_endpoint.token_regenerated");
    // El audit no lleva el token.
    expect(JSON.stringify(db.rows("audit_log"))).not.toContain(token);
  });

  it("no toca endpoints de otro workspace", async () => {
    const db = world();
    allowed();
    for (const res of [await updateWebhookEndpoint("ep-x", { name: "hack" }), await regenerateWebhookToken("ep-x"), await setWebhookEndpointStatus("ep-x", "paused"), await deleteWebhookEndpoint("ep-x")]) {
      expect(res.ok).toBe(false);
    }
    expect(db.rows("webhook_endpoints").find((r) => r.id === "ep-x")).toMatchObject({ name: "Ajeno", token: "B".repeat(22), status: "active", deleted_at: null });
  });

  it("pausar apaga la escucha; no se puede escuchar un endpoint pausado", async () => {
    const db = world();
    allowed();
    expect((await startWebhookListening("ep-1")).ok).toBe(true);
    expect(db.rows("webhook_endpoints")[0].listen_until).toBeTruthy();
    expect((await setWebhookEndpointStatus("ep-1", "paused")).ok).toBe(true);
    expect(db.rows("webhook_endpoints")[0]).toMatchObject({ status: "paused", listen_until: null });
    const res = await startWebhookListening("ep-1");
    expect(res.ok).toBe(false);
  });

  it("un JSON de ejemplo invalido se rechaza con el error de parseo; uno valido se guarda", async () => {
    const db = world();
    allowed();
    const bad = await saveWebhookSampleFromJson("ep-1", "{no es json");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/JSON no es válido/);
    expect((await saveWebhookSampleFromJson("ep-1", '{"email":"a@b.com"}')).ok).toBe(true);
    expect((db.rows("webhook_endpoints")[0].sample_payload as { payload: unknown }).payload).toEqual({ email: "a@b.com" });
  });

  it("borrar un endpoint usado por un flujo publicado se rechaza con el nombre del flujo", async () => {
    const db = world({
      triggers: [{ type: "webhook_received", config: { endpointId: "ep-1" }, flows: { id: "f-1", name: "Bienvenida", status: "published", workspace_id: WS } }],
    });
    allowed();
    const res = await deleteWebhookEndpoint("ep-1");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("«Bienvenida»");
    expect(db.rows("webhook_endpoints")[0].deleted_at).toBeNull();
  });

  it("sin flujos que lo usen, el borrado es suave", async () => {
    const db = world();
    allowed();
    expect((await deleteWebhookEndpoint("ep-1")).ok).toBe(true);
    expect(db.rows("webhook_endpoints")[0].deleted_at).toBeTruthy();
  });

  describe("reprocesar y la casilla «volver a correr también los flujos que ya corrieron»", () => {
    const inbound = { id: "in-1", workspace_id: WS, endpoint_id: "ep-1", status: "processed", payload: { a: 1 }, query: {}, received_at: "2026-10-12T12:00:00Z", reprocess_count: 0, result: {} };
    const extra = () => ({ inbound_webhooks: [{ ...inbound }], trigger_fires: [], flow_sessions: [], analytics_events: [], flows: [], webhook_endpoints_unused: [] });

    it("sin la casilla queda auditado quien lo pidio, con rerun_completed en falso", async () => {
      const db = world(extra());
      allowed();
      const res = await reprocessWebhookInbounds([{ id: "in-1", reprocessCount: 0 }]);
      expect(res).toMatchObject({ ok: true, reprocessed: 1 });
      const entry = db.rows("audit_log").find((r) => r.action === "webhook_endpoint.reprocessed");
      expect(entry).toMatchObject({ performed_by: "u-1", entity_id: "ep-1", metadata: { inbound_id: "in-1", reprocess_count: 1, rerun_completed: false } });
    });

    it("con la casilla queda auditado quien lo pidio, con rerun_completed en verdadero", async () => {
      const db = world(extra());
      allowed();
      const res = await reprocessWebhookInbounds([{ id: "in-1", reprocessCount: 0 }], { rerunCompleted: true });
      expect(res).toMatchObject({ ok: true, reprocessed: 1 });
      const entry = db.rows("audit_log").find((r) => r.action === "webhook_endpoint.reprocessed");
      expect(entry).toMatchObject({ performed_by: "u-1", metadata: { rerun_completed: true } });
    });

    it("la casilla solo vale si es exactamente `true` (cualquier otra cosa es apagada)", async () => {
      const db = world(extra());
      allowed();
      await reprocessWebhookInbounds([{ id: "in-1", reprocessCount: 0 }], { rerunCompleted: "si" as never });
      expect(db.rows("audit_log").find((r) => r.action === "webhook_endpoint.reprocessed")).toMatchObject({ metadata: { rerun_completed: false } });
    });
  });

  it("reprocesar mas de 100 se rechaza", async () => {
    world();
    allowed();
    const res = await reprocessWebhookInbounds(Array.from({ length: 101 }, (_, i) => ({ id: `in-${i}`, reprocessCount: 0 })));
    expect(res.ok).toBe(false);
  });
});
