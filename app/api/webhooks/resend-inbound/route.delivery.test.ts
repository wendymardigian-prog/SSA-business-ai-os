/**
 * Rebotes y quejas de Resend en el receptor (suscripcion a emails, E4).
 *
 * Mismas reglas que el resto del receptor: firma validada antes de tocar nada,
 * idempotencia por el id del evento, 200 inmediato y el cambio en `after()`.
 * Lo que se fija: firma invalida → 401 sin cambios; repetido → ignorado; rebote
 * duro → `bounced`; rebote temporal → solo se anota; queja → `complained`; un
 * workspace que no se ubica → 401; una direccion que no es de nadie → se ignora.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { expectedSignature } from "@/lib/email/svix";
import { fakeDb } from "@/lib/testing/fake-db";

const SECRET = `whsec_${Buffer.from("secreto-de-prueba-resend").toString("base64")}`;
const OTHER = `whsec_${Buffer.from("otro-secreto-de-otro-negocio").toString("base64")}`;

const h = vi.hoisted(() => ({
  db: null as unknown,
  pending: [] as Array<() => Promise<void>>,
  secrets: {} as Record<string, string | null>,
  claimed: new Set<string>(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => h.pending.push(fn),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (h.db as { client: unknown }).client) }));
vi.mock("@/lib/vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault")>()),
  readSecret: vi.fn(async (_db: unknown, workspaceId: string) => h.secrets[workspaceId] ?? null),
}));
vi.mock("@/lib/inbound", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbound")>()),
  claimWebhookEvent: vi.fn(async (_db: unknown, id: string | null) => {
    if (!id || h.claimed.has(id)) return false;
    h.claimed.add(id);
    return true;
  }),
}));

import { POST } from "./route";

function world(opts: { notFound?: boolean } = {}) {
  const db = fakeDb(
    {
      "email_log:select": { data: [{ workspace_id: "ws-1" }] },
      "messages:select": { data: [] },
      "integration_configs:select": { data: [{ workspace_id: "ws-1", provider: "resend", config: { from_email: "hola@negocio.test" } }, { workspace_id: "ws-2", provider: "resend", config: {} }] },
      "channels:select": { data: [] },
    },
    {
      set_email_status_by_address: (args: unknown) => {
        const a = args as { p_status: string };
        return opts.notFound
          ? { data: { status: null, changed: false, not_found: true } }
          : { data: { status: a.p_status, previous_status: "subscribed", changed: true, kept_existing: false, contacts_changed: 1 } };
      },
    },
  );
  h.db = db;
  return db;
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return { type, created_at: "2026-10-29T12:00:00Z", data: { email_id: "re_42", from: "Negocio <hola@negocio.test>", to: ["Ana@X.test"], subject: "Novedades", ...extra } };
}

async function send(body: unknown, opts: { secret?: string; id?: string; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${expectedSignature({ secret: opts.secret ?? SECRET, id, timestamp, body: raw })}`;
  const res = await POST(
    new NextRequest("https://app.test/api/webhooks/resend-inbound", {
      method: "POST",
      body: opts.tamper ? raw.replace("re_42", "re_43") : raw,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
    }),
  );
  for (const fn of h.pending.splice(0)) await fn();
  return res;
}

beforeEach(() => {
  h.pending = [];
  h.claimed = new Set();
  h.secrets = { "ws-1": SECRET, "ws-2": OTHER };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const statusCalls = (db: ReturnType<typeof world>) => db.rpcCalls.filter((c) => c.name === "set_email_status_by_address").map((c) => c.args as Record<string, unknown>);

describe("rebotes y quejas de Resend", () => {
  it("rebote duro (Permanent): la direccion queda 'bounced', como el sistema, en el workspace del email", async () => {
    const db = world();
    const res = await send(event("email.bounced", { bounce: { type: "Permanent", subType: "Suppressed", message: "hard" } }));
    expect(res.status).toBe(200);
    expect(statusCalls(db)).toEqual([
      expect.objectContaining({ p_workspace_id: "ws-1", p_email: "ana@x.test", p_status: "bounced", p_source: "resend_bounce", p_mode: "system" }),
    ]);
  });

  it("rebote temporal: se anota y NO cambia el estado", async () => {
    const db = world();
    const res = await send(event("email.bounced", { bounce: { type: "Temporary", message: "buzon lleno" } }));
    expect(res.status).toBe(200);
    expect(statusCalls(db)).toEqual([]);
  });

  it("queja (spam): 'complained'", async () => {
    const db = world();
    await send(event("email.complained"));
    expect(statusCalls(db)).toEqual([expect.objectContaining({ p_status: "complained", p_source: "resend_complaint", p_mode: "system" })]);
  });

  it("firma invalida (cuerpo alterado): 401 y no se toca nada", async () => {
    const db = world();
    const res = await send(event("email.complained"), { tamper: true });
    expect(res.status).toBe(401);
    expect(statusCalls(db)).toEqual([]);
  });

  it("la firma de OTRO negocio: se prueba con cada secreto y se aplica en el workspace cuya firma coincide", async () => {
    const db = world();
    const res = await send(event("email.complained"), { secret: OTHER });
    expect(res.status).toBe(200);
    expect(statusCalls(db)[0]).toMatchObject({ p_workspace_id: "ws-2" });
  });

  it("sin ningun secreto que coincida: 401", async () => {
    world();
    h.secrets = {};
    expect((await send(event("email.complained"))).status).toBe(401);
  });

  it("el mismo evento dos veces: el segundo se ignora", async () => {
    const db = world();
    await send(event("email.complained"), { id: "msg_dup" });
    const second = await send(event("email.complained"), { id: "msg_dup" });
    expect(await second.json()).toMatchObject({ skipped: "evento repetido" });
    expect(statusCalls(db)).toHaveLength(1);
  });

  it("una direccion que no es de ningun contacto: 200 y se ignora", async () => {
    world({ notFound: true });
    const res = await send(event("email.bounced", { bounce: { type: "Permanent" } }));
    expect(res.status).toBe(200);
  });

  it("los demas eventos (delivered, opened) se siguen ignorando sin firmar nada", async () => {
    const db = world();
    const res = await send(event("email.delivered"));
    expect(await res.json()).toMatchObject({ skipped: "email.delivered" });
    expect(statusCalls(db)).toEqual([]);
  });
});
