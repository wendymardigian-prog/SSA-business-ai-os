/**
 * El receptor con `email.received` (caracterizacion, conexion de Resend).
 *
 * Fija lo que ya hacia antes de la recepcion por dominio: el correo a la direccion del canal entra al canal de ese
 * workspace; una firma invalida da 401 sin tocar nada; el mismo evento dos veces se procesa una; una direccion que no
 * es nuestra se reconoce y se ignora. Lo nuevo (dominio, `?w=`) se prueba en `route.domain.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { expectedSignature } from "@/lib/email/svix";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";

const SECRET = `whsec_${Buffer.from("secreto-de-prueba-resend").toString("base64")}`;

const h = vi.hoisted(() => ({
  db: null as unknown,
  pending: [] as Array<() => Promise<void>>,
  secrets: {} as Record<string, string | null>,
  claimed: new Set<string>(),
  processed: [] as Array<{ channelId: string; workspaceId: string; to: string[] }>,
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
vi.mock("@/lib/email/receiving", () => ({ fetchReceivedEmail: vi.fn(async () => null) }));
vi.mock("@/lib/email/inbound", () => ({
  processInboundEmail: vi.fn(async (_db: unknown, p: { channel: { id: string; workspace_id: string }; email: { to: string[] } }) => {
    h.processed.push({ channelId: p.channel.id, workspaceId: p.channel.workspace_id, to: p.email.to });
    return { stored: true, automatic: false, conversationId: null, contactId: null };
  }),
}));
vi.mock("@/lib/email/triggers", () => ({ runEmailTriggers: vi.fn(async () => {}) }));

import { POST } from "./route";

export interface TestChannel {
  id: string;
  workspace_id: string;
  email_address: string;
}

const CHANNELS: TestChannel[] = [
  { id: "ch-1", workspace_id: "ws-1", email_address: "hola@negocio.test" },
  { id: "ch-2", workspace_id: "ws-2", email_address: "info@otra.test" },
];

/** Un Supabase que filtra los canales por las columnas que pide el receptor. */
function world(channels: TestChannel[] = CHANNELS) {
  const pick = (call: DbCall) =>
    channels.filter((c) =>
      call.filters.every((f) => {
        if (f.method !== "eq") return true;
        const value = (c as unknown as Record<string, unknown>)[f.column];
        if (f.column === "platform") return f.value === "email";
        if (f.column === "is_active") return f.value === true;
        return value === undefined || value === f.value;
      }),
    );
  const db = fakeDb({
    "channels:select": (call) => ({ data: pick(call).map((c) => ({ ...c, platform: "email", is_active: true })) }),
  });
  h.db = db;
  return db;
}

function received(to: string[], extra: Record<string, unknown> = {}) {
  return { type: "email.received", created_at: "2026-11-02T12:00:00Z", data: { email_id: "re_in_1", from: "Ana <ana@cliente.test>", to, subject: "Consulta", ...extra } };
}

async function send(body: unknown, opts: { secret?: string; id?: string; tamper?: boolean; url?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${expectedSignature({ secret: opts.secret ?? SECRET, id, timestamp, body: raw })}`;
  const res = await POST(
    new NextRequest(opts.url ?? "https://app.test/api/webhooks/resend-inbound", {
      method: "POST",
      body: opts.tamper ? raw.replace("Consulta", "Otra cosa") : raw,
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
    }),
  );
  for (const fn of h.pending.splice(0)) await fn();
  return res;
}

beforeEach(() => {
  h.pending = [];
  h.claimed = new Set();
  h.processed = [];
  h.secrets = { "ws-1": SECRET, "ws-2": `whsec_${Buffer.from("otro-secreto-de-otro-negocio").toString("base64")}` };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("email.received (caracterizacion)", () => {
  it("a la direccion exacta del canal: entra al canal de ese workspace", async () => {
    world();
    const res = await send(received(["hola@negocio.test"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true });
    expect(h.processed).toEqual([{ channelId: "ch-1", workspaceId: "ws-1", to: ["hola@negocio.test"] }]);
  });

  it("la direccion en mayusculas o en copia (cc) tambien se reconoce", async () => {
    world();
    await send(received(["alguien@cliente.test"], { cc: ["HOLA@negocio.test"] }));
    expect(h.processed).toHaveLength(1);
    expect(h.processed[0]).toMatchObject({ channelId: "ch-1" });
  });

  it("firma invalida (cuerpo alterado): 401 y no se procesa nada", async () => {
    world();
    const res = await send(received(["hola@negocio.test"]), { tamper: true });
    expect(res.status).toBe(401);
    expect(h.processed).toEqual([]);
  });

  it("firmado con el secreto de OTRO negocio: 401", async () => {
    world();
    const res = await send(received(["hola@negocio.test"]), { secret: h.secrets["ws-2"]! });
    expect(res.status).toBe(401);
    expect(h.processed).toEqual([]);
  });

  it("el mismo evento dos veces: el segundo se ignora", async () => {
    world();
    await send(received(["hola@negocio.test"]), { id: "msg_dup" });
    const second = await send(received(["hola@negocio.test"]), { id: "msg_dup" });
    expect(await second.json()).toMatchObject({ skipped: "evento repetido" });
    expect(h.processed).toHaveLength(1);
  });

  it("una direccion que no es nuestra: 200 y se ignora", async () => {
    world();
    const res = await send(received(["alguien@desconocido.test"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "direccion desconocida" });
    expect(h.processed).toEqual([]);
  });

  it("sin secreto guardado en el workspace: 401", async () => {
    world();
    h.secrets = {};
    expect((await send(received(["hola@negocio.test"]))).status).toBe(401);
  });

  it("sin destinatario: 200 y se ignora", async () => {
    world();
    expect(await (await send(received([]))).json()).toMatchObject({ skipped: "sin destinatario" });
  });
});
