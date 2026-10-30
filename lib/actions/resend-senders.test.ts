/**
 * Los remitentes de Resend (E8): la accion que trae los dominios nunca devuelve la
 * key; guardar exige un dominio verificado (si se pudo listar) y deja el
 * `from_email` compuesto que leen el envio y el aviso.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { clearResendDomainsCache } from "@/lib/email/resend-domains";

const KEY = "re_key_super_secreta_que_no_sale_nunca";
const h = vi.hoisted(() => ({ ctx: null as unknown, service: null as unknown, fetchBody: null as unknown, fetchStatus: 200 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: vi.fn(() => ({ from_email: { old: null, new: "x" } })) }));
vi.mock("@/lib/auth/guards", () => ({ getPermissionAction: vi.fn(async (key: string) => (key === "integrations.manage" ? h.ctx : null)) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (h.service as { client: unknown }).client) }));

import { loadResendDomains, saveResendSenders } from "./resend-senders";

function setup(opts: { status?: number; domains?: Array<{ name: string; status: string }>; existing?: boolean } = {}) {
  const user = fakeDb({
    "integration_configs:select": { data: opts.existing === false ? null : { id: "cfg-1", config: { from_email: "app@wendymardigian.com", from_name: "Wendy" } } },
    "integration_configs:update": { data: null },
  });
  h.ctx = { supabase: user.client, workspace: { id: `ws-${Math.random()}` }, user: { id: "u-1" } };
  h.service = fakeDb({}, { read_secret: { data: KEY } });
  const status = opts.status ?? 200;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: opts.domains ?? [{ name: "mail.wendymardigian.com", status: "verified" }, { name: "wendymardigian.com", status: "pending" }] }), { status })));
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearResendDomainsCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadResendDomains", () => {
  it("pide integrations.manage", async () => {
    setup();
    h.ctx = null;
    expect(await loadResendDomains()).toMatchObject({ ok: false });
  });

  it("devuelve nombres y estados; la key NO aparece en la respuesta", async () => {
    setup();
    const res = await loadResendDomains();
    expect(res).toEqual({ ok: true, domains: [{ name: "mail.wendymardigian.com", status: "verified" }, { name: "wendymardigian.com", status: "pending" }] });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("una key sin permiso para listar: el aviso para escribir el dominio a mano (sin la key)", async () => {
    setup({ status: 401 });
    const res = await loadResendDomains();
    expect(res).toEqual({ ok: false, listable: false, message: "Tu API key no puede listar dominios; escribí el dominio a mano o usá una key con acceso completo." });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });
});

describe("saveResendSenders", () => {
  it("un dominio verificado: guarda usuario, dominio y el from_email compuesto, y conserva lo demas de la config", async () => {
    const { user } = setup();
    expect(await saveResendSenders({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com", fromName: "Wendy" })).toEqual({ ok: true });
    const saved = user.writesTo("integration_configs")[0].values as { config: Record<string, unknown> };
    expect(saved.config).toMatchObject({ from_local: "hola", from_domain: "mail.wendymardigian.com", from_email: "hola@mail.wendymardigian.com", from_name: "Wendy" });
    expect(JSON.stringify(saved)).not.toContain(KEY);
  });

  it("un dominio que Resend no tiene verificado no se guarda y se explica por que", async () => {
    const { user } = setup();
    const res = await saveResendSenders({ fromLocal: "app", fromDomain: "wendymardigian.com" });
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("no está verificado") });
    expect(user.writesTo("integration_configs")).toEqual([]);
  });

  it("con una key que no lista dominios, el dominio a mano se guarda", async () => {
    const { user } = setup({ status: 403 });
    expect(await saveResendSenders({ fromLocal: "hola", fromDomain: "mail.otro.com" })).toEqual({ ok: true });
    expect((user.writesTo("integration_configs")[0].values as { config: Record<string, unknown> }).config.from_email).toBe("hola@mail.otro.com");
  });

  it("sin Resend conectado no hay nada que guardar", async () => {
    setup({ existing: false });
    expect(await saveResendSenders({ fromLocal: "hola", fromDomain: "mail.wendymardigian.com" })).toMatchObject({ ok: false });
  });
});
