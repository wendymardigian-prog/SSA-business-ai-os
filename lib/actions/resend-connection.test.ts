/**
 * Las acciones de la tarjeta Resend: piden `integrations.manage`, el negocio sale de la sesion y ni la key ni el
 * secreto vuelven al navegador ni quedan en el historial.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  connect: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  receiving: vi.fn(),
  live: vi.fn(),
  domains: vi.fn(),
  notify: vi.fn(),
  logAudit: vi.fn(),
  keys: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: h.logAudit }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: vi.fn(async (key: string) => {
    h.keys.push(key);
    return key === "integrations.manage" ? h.ctx : null;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => ({ service: true })) }));
vi.mock("@/lib/email/resend-connection", () => ({
  connectWebhookForWorkspace: h.connect,
  saveWebhookSecret: h.save,
  clearWebhookSecret: h.clear,
  saveReceiving: h.receiving,
  checkResendLive: h.live,
}));
vi.mock("@/lib/email/resend-domains", () => ({ workspaceResendDomains: h.domains }));
vi.mock("@/lib/channels/new-channel-access", () => ({ notifyNewChannelAccess: h.notify }));

import {
  checkResendConnectionAction,
  clearResendWebhookSecretAction,
  connectResendWebhookAction,
  saveResendReceivingAction,
  saveResendWebhookSecretAction,
} from "./resend-connection";

const SECRET = `whsec_${Buffer.from("secreto-pegado-a-mano-por-alguien").toString("base64")}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.keys = [];
  h.ctx = { workspace: { id: "ws-sesion" }, supabase: {}, user: { id: "u-1" } };
  h.connect.mockResolvedValue({ ok: true, action: "created", needsSecret: false, disabled: false });
  h.save.mockResolvedValue({ ok: true });
  h.clear.mockResolvedValue({ ok: true });
});

describe("acciones del webhook de Resend", () => {
  it("sin integrations.manage no se toca nada", async () => {
    h.ctx = null;
    expect((await connectResendWebhookAction()).ok).toBe(false);
    expect((await saveResendWebhookSecretAction({ secret: SECRET })).ok).toBe(false);
    expect((await clearResendWebhookSecretAction()).ok).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    expect(new Set(h.keys)).toEqual(new Set(["integrations.manage"]));
  });

  it("conectar usa el negocio de la sesion y deja el historial", async () => {
    const res = await connectResendWebhookAction();
    expect(res).toMatchObject({ ok: true, needsSecret: false });
    expect(h.connect).toHaveBeenCalledWith({ service: { service: true }, workspaceId: "ws-sesion" });
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-sesion", metadata: expect.objectContaining({ provider: "resend", kind: "resend_webhook" }) }));
  });

  it("pegar el secreto: ni la respuesta ni el historial lo llevan", async () => {
    const res = await saveResendWebhookSecretAction({ secret: SECRET });
    expect(res.ok).toBe(true);
    expect(h.save).toHaveBeenCalledWith({ service: { service: true }, workspaceId: "ws-sesion", secret: SECRET });
    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(JSON.stringify(h.logAudit.mock.calls)).not.toContain(SECRET);
  });

  it("un error del nucleo vuelve como mensaje, sin historial", async () => {
    h.connect.mockResolvedValue({ ok: false, reason: "restricted", error: "solo envio" });
    expect(await connectResendWebhookAction()).toEqual({ ok: false, error: "solo envio" });
    expect(h.logAudit).not.toHaveBeenCalled();
  });
});

describe("recepcion y Probar", () => {
  it("sin integrations.manage: ni recepcion ni Probar", async () => {
    h.ctx = null;
    expect((await saveResendReceivingAction({ enabled: true, domain: "d.test", local: "hola" })).ok).toBe(false);
    expect((await checkResendConnectionAction()).ok).toBe(false);
    expect(h.receiving).not.toHaveBeenCalled();
    expect(h.live).not.toHaveBeenCalled();
  });

  it("prender la recepcion con canal nuevo avisa a los roles por cuenta y deja historial", async () => {
    h.receiving.mockResolvedValue({ ok: true, enabled: true, address: "hola@d.test", channelCreated: { channelId: "ch-1", label: "hola@d.test" }, warnings: ["aviso"] });
    const res = await saveResendReceivingAction({ enabled: true, domain: "d.test", local: "hola" });
    expect(res).toMatchObject({ ok: true, warnings: ["aviso"] });
    expect(h.receiving).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-sesion", enabled: true, domain: "d.test", local: "hola" }));
    expect(h.notify).toHaveBeenCalledWith({ service: true }, { workspaceId: "ws-sesion", channelId: "ch-1", label: "hola@d.test" });
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ kind: "resend_receiving", enabled: true }) }));
  });

  it("Probar: solo lectura y devuelve los dominios", async () => {
    h.live.mockResolvedValue({ key: { ok: true, access: "full" }, webhook: { checked: true, found: false } });
    h.domains.mockResolvedValue({ ok: true, domains: [{ name: "d.test", status: "verified" }] });
    const res = await checkResendConnectionAction();
    expect(res).toEqual({ ok: true, live: { key: { ok: true, access: "full" }, webhook: { checked: true, found: false } }, domains: [{ name: "d.test", status: "verified" }] });
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.logAudit).not.toHaveBeenCalled();
  });
});
