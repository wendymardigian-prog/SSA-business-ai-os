/**
 * Guardar la key de Resend (conexion de Resend, R2): se prueba contra Resend antes de guardar, se marca el acceso, y
 * una key de acceso completo conecta el webhook sola (sin hacer fallar el guardado si no se puede). Volver a guardar
 * la key no borra el estado del webhook ni de la recepcion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  storeSecret: vi.fn(),
  listSecretNames: vi.fn(),
  connect: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext: h.ctx, getPermissionAction: h.ctx, getAnyPermissionAction: h.ctx }));
vi.mock("@/lib/vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault")>()),
  storeSecret: h.storeSecret,
  listSecretNames: h.listSecretNames,
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => "audit-1") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => ({ service: true })) }));
vi.mock("@/lib/email/resend-connection", () => ({ connectWebhookForWorkspace: h.connect }));

import { saveIntegration } from "./integrations";

const KEY = "re_abcdefghijklmnopqrstuvwxyz123";

function setup(seed: Array<Record<string, unknown>> = []) {
  const db = memoryDb({ integration_configs: seed });
  h.ctx.mockResolvedValue({ workspace: { id: "ws-1" }, supabase: db.client, user: { id: "u-1" } });
  return db;
}

function respond(status: number, body: unknown) {
  h.fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", h.fetchMock);
  h.storeSecret.mockResolvedValue({ ok: true });
  h.listSecretNames.mockResolvedValue([]);
  h.connect.mockResolvedValue({ ok: true, action: "created", needsSecret: false, disabled: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("guardar la key de Resend", () => {
  it("acceso completo: se guarda marcada `full` y conecta el webhook solo", async () => {
    const db = setup();
    respond(200, { data: [] });
    expect(await saveIntegration({ providerId: "resend", secrets: { api_key: KEY } })).toEqual({ ok: true });
    expect(h.storeSecret).toHaveBeenCalledWith(expect.anything(), "ws-1", "resend_api_key", KEY);
    expect(db.rows("integration_configs")[0]).toMatchObject({ provider: "resend", is_active: true, config: { access: "full" } });
    expect(h.connect).toHaveBeenCalledWith({ service: { service: true }, workspaceId: "ws-1" });
  });

  it("si el webhook no se pudo conectar, la key queda guardada y vuelve un aviso", async () => {
    setup();
    respond(200, { data: [] });
    h.connect.mockResolvedValue({ ok: false, reason: "failed", error: "Resend no respondió." });
    const res = await saveIntegration({ providerId: "resend", secrets: { api_key: KEY } });
    expect(res).toEqual({ ok: true, warnings: [expect.stringContaining("no pude conectar el webhook")] });
  });

  it("adoptado sin secreto: aviso para pegarlo", async () => {
    setup();
    respond(200, { data: [] });
    h.connect.mockResolvedValue({ ok: true, action: "adopted", needsSecret: true, disabled: false });
    const res = await saveIntegration({ providerId: "resend", secrets: { api_key: KEY } });
    expect(res).toEqual({ ok: true, warnings: [expect.stringContaining("Signing secret")] });
  });

  it("solo envio: se guarda marcada `sending` y NO intenta conectar el webhook (plan B a mano)", async () => {
    const db = setup();
    respond(401, { name: "restricted_api_key" });
    expect(await saveIntegration({ providerId: "resend", secrets: { api_key: KEY } })).toEqual({ ok: true });
    expect(db.rows("integration_configs")[0]).toMatchObject({ config: { access: "sending" } });
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("key invalida: no se guarda nada", async () => {
    const db = setup();
    respond(401, { name: "validation_error" });
    const res = await saveIntegration({ providerId: "resend", secrets: { api_key: KEY } });
    expect(res.ok).toBe(false);
    expect(h.storeSecret).not.toHaveBeenCalled();
    expect(db.rows("integration_configs")).toHaveLength(0);
  });

  it("volver a guardar (sin key nueva) conserva el webhook, la recepcion y los remitentes; no conecta de nuevo", async () => {
    h.listSecretNames.mockResolvedValue(["resend_api_key"]);
    const config = {
      from_email: "hola@negocio.test",
      access: "full",
      webhook_id: "wh_1",
      webhook_events: "email.received,email.bounced,email.complained",
      webhook_secret_saved_at: "2026-11-02T00:00:00Z",
      receiving_enabled: "true",
      receiving_domain: "negocio.test",
      receiving_local: "hola",
    };
    const db = setup([{ id: "cfg-1", workspace_id: "ws-1", type: "email_provider", provider: "resend", is_active: true, config }]);
    expect(await saveIntegration({ providerId: "resend", config: {} })).toEqual({ ok: true });
    expect(db.rows("integration_configs")[0].config).toEqual(config);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });
});
