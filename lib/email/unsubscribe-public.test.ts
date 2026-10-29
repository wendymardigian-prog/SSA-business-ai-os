/**
 * La baja publica por token (E3): la pagina, sus botones y el endpoint de un clic.
 * Lo que se fija: un token sin forma no llega a la base, uno que no existe no dice
 * nada, abrir la pagina no da de baja, la baja y la vuelta son de la propia persona
 * (modo `person`), y no sale ningun dato del contacto salvo la direccion enmascarada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";

const TOKEN = "3f1c2a7e-1111-4222-8333-944445555666";
const svc = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (svc.current as { client: unknown }).client) }));

import { applyUnsubscribeAction, isUnsubscribeToken, loadUnsubscribeTarget, publicView } from "./unsubscribe-public";
import { POST, GET } from "@/app/api/email/baja/[token]/route";

function world(opts: { contact?: Record<string, unknown> | null; allowed?: boolean; status?: string } = {}) {
  const db = fakeDb(
    {
      "contacts:select": { data: opts.contact === undefined ? { id: "c-1", workspace_id: "ws-1", email: "wendy@gmail.com", secondary_email: null, email_status: opts.status ?? "subscribed" } : opts.contact },
      "workspaces:select": { data: { brand_name: "Mi Negocio" } },
    },
    {
      bump_rate_limit: { data: opts.allowed === false ? 999 : 1 },
      set_email_status: (args: unknown) => {
        const a = args as { p_status: string };
        return { data: { status: a.p_status, previous_status: "subscribed", changed: true, kept_existing: false } };
      },
    },
  );
  svc.current = db;
  return db;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("el token", () => {
  it("solo un uuid llega a la base", async () => {
    const db = world();
    expect(isUnsubscribeToken("no-es-un-token")).toBe(false);
    expect(await loadUnsubscribeTarget(db.client, "' or 1=1 --")).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it("uno que no existe: null, sin datos", async () => {
    const db = world({ contact: null });
    expect(await loadUnsubscribeTarget(db.client, TOKEN)).toBeNull();
  });
});

describe("lo que ve la persona", () => {
  it("solo la direccion enmascarada, el estado y la marca", async () => {
    const db = world();
    const target = await loadUnsubscribeTarget(db.client, TOKEN);
    const view = publicView(target!);
    expect(view).toEqual({ maskedAddress: "w***@gmail.com", status: "subscribed", brandName: "Mi Negocio", canResubscribe: true });
    expect(JSON.stringify(view)).not.toContain("wendy");
    expect(JSON.stringify(view)).not.toContain("c-1");
  });

  it("desde un rebote o una queja no se ofrece volver", () => {
    const base = { contactId: "c", workspaceId: "w", address: "a@x.com", brandName: "N" };
    expect(publicView({ ...base, status: "bounced" }).canResubscribe).toBe(false);
    expect(publicView({ ...base, status: "complained" }).canResubscribe).toBe(false);
    expect(publicView({ ...base, status: "unsubscribed" }).canResubscribe).toBe(true);
  });

  it("leer el token NO cambia nada (abrir la pagina no da de baja)", async () => {
    const db = world();
    await loadUnsubscribeTarget(db.client, TOKEN);
    expect(db.rpcCalls.map((c) => c.name)).not.toContain("set_email_status");
    expect(db.writes()).toEqual([]);
  });
});

describe("dar de baja y volver", () => {
  it("el boton da de baja como la propia persona, en la direccion del contacto", async () => {
    const db = world();
    const out = await applyUnsubscribeAction(db.client, { token: TOKEN, ip: "1.2.3.4", action: "unsubscribe", source: "unsubscribe_page" });
    expect(out).toMatchObject({ ok: true, view: { status: "unsubscribed", maskedAddress: "w***@gmail.com" } });
    expect(db.rpcCalls.find((c) => c.name === "set_email_status")?.args).toMatchObject({
      p_contact_id: "c-1", p_status: "unsubscribed", p_source: "unsubscribe_page", p_mode: "person", p_address: "wendy@gmail.com",
    });
  });

  it("volver a suscribirse tambien es de la persona (la base decide si se puede)", async () => {
    const db = world({ status: "unsubscribed" });
    await applyUnsubscribeAction(db.client, { token: TOKEN, ip: "1.2.3.4", action: "resubscribe", source: "unsubscribe_page" });
    expect(db.rpcCalls.find((c) => c.name === "set_email_status")?.args).toMatchObject({ p_status: "subscribed", p_mode: "person" });
  });

  it("pasado el tope por IP, no toca nada", async () => {
    const db = world({ allowed: false });
    expect(await applyUnsubscribeAction(db.client, { token: TOKEN, ip: "1.2.3.4", action: "unsubscribe", source: "one_click" })).toEqual({ ok: false, reason: "rate_limited" });
    expect(db.rpcCalls.map((c) => c.name)).not.toContain("set_email_status");
  });
});

describe("POST /api/email/baja/<token> (un clic)", () => {
  const post = (token: string) => POST(new Request(`https://app.test/api/email/baja/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" }), { params: Promise.resolve({ token }) });

  it("con un token que existe: 200 y la baja como one_click", async () => {
    const db = world();
    const res = await post(TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.rpcCalls.find((c) => c.name === "set_email_status")?.args).toMatchObject({ p_status: "unsubscribed", p_source: "one_click", p_mode: "person" });
  });

  it("idempotente: ya dado de baja (o rebotando) responde 200 igual", async () => {
    world({ status: "bounced" });
    expect((await post(TOKEN)).status).toBe(200);
  });

  it("un token que no existe: 404 sin nada en el cuerpo", async () => {
    world({ contact: null });
    const res = await post(TOKEN);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("un token sin forma: 404 sin tocar la base", async () => {
    const db = world();
    expect((await post("cualquier-cosa")).status).toBe(404);
    expect(db.calls).toEqual([]);
  });

  it("GET lleva a la pagina (que no da de baja al abrirse)", async () => {
    const db = world();
    const res = await GET(new Request(`https://app.test/api/email/baja/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`/baja/${TOKEN}$`));
    expect(db.rpcCalls).toEqual([]);
  });
});
