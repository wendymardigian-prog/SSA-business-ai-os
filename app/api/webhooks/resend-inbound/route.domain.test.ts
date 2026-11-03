/**
 * El receptor de Resend con la conexion nueva (R3 y R4).
 *
 * R3: con `?w=<negocio>` se verifica SOLO con el secreto de ese negocio; rebotes y quejas se aplican aunque el negocio
 * no reciba emails (no tiene canal); dos negocios en la misma instalacion, cada aviso al suyo.
 * R4: un email a CUALQUIER direccion del dominio del canal entra; a otro dominio, no; dos negocios con el mismo
 * dominio sin `?w=` no se adivina (401); con `?w=` gana el parametro.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { expectedSignature } from "@/lib/email/svix";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";

const WS1 = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const S1 = `whsec_${Buffer.from("secreto-del-negocio-uno-1234").toString("base64")}`;
const S2 = `whsec_${Buffer.from("secreto-del-negocio-dos-5678").toString("base64")}`;

const h = vi.hoisted(() => ({
  db: null as unknown,
  pending: [] as Array<() => Promise<void>>,
  secrets: {} as Record<string, string | null>,
  secretReads: [] as string[],
  claimed: new Set<string>(),
  processed: [] as Array<{ channelId: string; workspaceId: string }>,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => h.pending.push(fn),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => (h.db as { client: unknown }).client) }));
vi.mock("@/lib/vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vault")>()),
  readSecret: vi.fn(async (_db: unknown, workspaceId: string) => {
    h.secretReads.push(workspaceId);
    return h.secrets[workspaceId] ?? null;
  }),
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
  processInboundEmail: vi.fn(async (_db: unknown, p: { channel: { id: string; workspace_id: string } }) => {
    h.processed.push({ channelId: p.channel.id, workspaceId: p.channel.workspace_id });
    return { stored: true, automatic: false, conversationId: null, contactId: null };
  }),
}));
vi.mock("@/lib/email/triggers", () => ({ runEmailTriggers: vi.fn(async () => {}) }));

import { POST } from "./route";

interface Ch {
  id: string;
  workspace_id: string;
  email_address: string;
}

function world(channels: Ch[]) {
  const pick = (call: DbCall) =>
    channels.filter((c) =>
      call.filters.every((f) => {
        if (f.method !== "eq") return true;
        if (f.column === "platform") return f.value === "email";
        if (f.column === "is_active") return f.value === true;
        const value = (c as unknown as Record<string, unknown>)[f.column];
        return value === undefined || value === f.value;
      }),
    );
  const db = fakeDb(
    {
      "channels:select": (call) => ({ data: pick(call).map((c) => ({ ...c, platform: "email", is_active: true })) }),
      "email_log:select": { data: [] },
      "messages:select": { data: [] },
      // Sin `?w=`, rebotes y quejas prueban cada negocio con Resend (lo de antes).
      "integration_configs:select": { data: [{ workspace_id: WS1, provider: "resend", config: {} }, { workspace_id: WS2, provider: "resend", config: {} }] },
    },
    {
      set_email_status_by_address: (args: unknown) => ({ data: { status: (args as { p_status: string }).p_status, changed: true, contacts_changed: 1 } }),
    },
  );
  h.db = db;
  return db;
}

async function send(body: unknown, opts: { secret: string; w?: string; id?: string }) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v1,${expectedSignature({ secret: opts.secret, id, timestamp, body: raw })}`;
  const url = `https://app.test/api/webhooks/resend-inbound${opts.w !== undefined ? `?w=${opts.w}` : ""}`;
  const res = await POST(new NextRequest(url, { method: "POST", body: raw, headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature } }));
  for (const fn of h.pending.splice(0)) await fn();
  return res;
}

const received = (to: string[], extra: Record<string, unknown> = {}) => ({
  type: "email.received",
  data: { email_id: "re_in", from: "Ana <ana@cliente.test>", to, subject: "Hola", ...extra },
});
const complaint = { type: "email.complained", data: { email_id: "re_out", from: "hola@negocio.test", to: ["ana@cliente.test"] } };
const bounce = { type: "email.bounced", data: { email_id: "re_out", from: "hola@negocio.test", to: ["ana@cliente.test"], bounce: { type: "Permanent" } } };

const statusCalls = (db: ReturnType<typeof world>) =>
  db.rpcCalls.filter((c) => c.name === "set_email_status_by_address").map((c) => c.args as { p_workspace_id: string; p_status: string });

beforeEach(() => {
  h.pending = [];
  h.claimed = new Set();
  h.processed = [];
  h.secretReads = [];
  h.secrets = { [WS1]: S1, [WS2]: S2 };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("R3: el secreto del webhook, con o sin recepcion", () => {
  it("una queja con ?w= se aplica en ese negocio aunque NO tenga canal de email (sin recepcion)", async () => {
    const db = world([]);
    const res = await send(complaint, { secret: S1, w: WS1 });
    expect(res.status).toBe(200);
    expect(statusCalls(db)).toEqual([expect.objectContaining({ p_workspace_id: WS1, p_status: "complained" })]);
    // Solo se probo el secreto del negocio del parametro.
    expect(h.secretReads).toEqual([WS1]);
  });

  it("un rebote sin recepcion, por la URL de siempre (sin ?w=), tambien se aplica", async () => {
    const db = world([]);
    await send(bounce, { secret: S2 });
    expect(statusCalls(db)).toEqual([expect.objectContaining({ p_workspace_id: WS2, p_status: "bounced" })]);
  });

  it("dos negocios: cada aviso va al suyo", async () => {
    const db = world([]);
    await send(complaint, { secret: S1, w: WS1 });
    await send(bounce, { secret: S2, w: WS2 });
    expect(statusCalls(db).map((c) => [c.p_workspace_id, c.p_status])).toEqual([
      [WS1, "complained"],
      [WS2, "bounced"],
    ]);
  });

  it("?w= de un negocio con la firma de OTRO: 401, no prueba los demas", async () => {
    const db = world([]);
    const res = await send(complaint, { secret: S2, w: WS1 });
    expect(res.status).toBe(401);
    expect(statusCalls(db)).toEqual([]);
    expect(h.secretReads).toEqual([WS1]);
  });

  it("un ?w= que no es un id: 401 sin leer ningun secreto", async () => {
    world([]);
    const res = await send(complaint, { secret: S1, w: "cualquier-cosa" });
    expect(res.status).toBe(401);
    expect(h.secretReads).toEqual([]);
  });

  it("cada aviso valido anota el 'ultimo aviso' del negocio (solo esa columna)", async () => {
    const db = world([]);
    await send(complaint, { secret: S1, w: WS1 });
    const touch = db.writesTo("integration_configs");
    expect(touch).toHaveLength(1);
    expect(Object.keys(touch[0].values as object)).toEqual(["last_event_at"]);
    expect(touch[0].filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "workspace_id", value: WS1 }), expect.objectContaining({ column: "provider", value: "resend" })]));
  });

  it("una firma invalida no anota nada", async () => {
    const db = world([]);
    await send(complaint, { secret: S2, w: WS1 });
    expect(db.writesTo("integration_configs")).toEqual([]);
  });
});

describe("R4: recepcion por dominio", () => {
  const CHANNELS: Ch[] = [
    { id: "ch-1", workspace_id: WS1, email_address: "hola@negocio.test" },
    { id: "ch-2", workspace_id: WS2, email_address: "info@otro.test" },
  ];

  it("cualquier direccion del dominio entra al canal del negocio", async () => {
    world(CHANNELS);
    await send(received(["soporte@negocio.test"]), { secret: S1 });
    await send(received(["Ventas <VENTAS@negocio.test>"]), { secret: S1 });
    expect(h.processed).toEqual([
      { channelId: "ch-1", workspaceId: WS1 },
      { channelId: "ch-1", workspaceId: WS1 },
    ]);
  });

  it("en copia oculta (received_for) tambien", async () => {
    world(CHANNELS);
    await send(received(["alguien@cliente.test"], { received_for: ["facturas@negocio.test"] }), { secret: S1 });
    expect(h.processed).toEqual([{ channelId: "ch-1", workspaceId: WS1 }]);
  });

  it("otro dominio (o un subdominio distinto) no entra", async () => {
    world(CHANNELS);
    expect(await (await send(received(["hola@mail.negocio.test"]), { secret: S1 })).json()).toMatchObject({ skipped: "direccion desconocida" });
    expect(await (await send(received(["hola@desconocido.test"]), { secret: S1 })).json()).toMatchObject({ skipped: "direccion desconocida" });
    expect(h.processed).toEqual([]);
  });

  it("con ?w=: entra al canal de ese negocio si es de su dominio; si no, se ignora", async () => {
    world(CHANNELS);
    await send(received(["soporte@otro.test"]), { secret: S2, w: WS2 });
    expect(h.processed).toEqual([{ channelId: "ch-2", workspaceId: WS2 }]);
    const res = await send(received(["soporte@negocio.test"]), { secret: S2, w: WS2 });
    expect(await res.json()).toMatchObject({ skipped: "direccion desconocida" });
    expect(h.processed).toHaveLength(1);
  });

  describe("dos negocios con el MISMO dominio", () => {
    const SAME: Ch[] = [
      { id: "ch-1", workspace_id: WS1, email_address: "hola@compartido.test" },
      { id: "ch-2", workspace_id: WS2, email_address: "ventas@compartido.test" },
    ];

    it("sin ?w= y sin direccion exacta: 401 (no se adivina) y no se procesa", async () => {
      world(SAME);
      const res = await send(received(["soporte@compartido.test"]), { secret: S1 });
      expect(res.status).toBe(401);
      expect(h.processed).toEqual([]);
    });

    it("sin ?w= pero a la direccion EXACTA de un canal: va a ese (lo de siempre)", async () => {
      world(SAME);
      await send(received(["ventas@compartido.test"]), { secret: S2 });
      expect(h.processed).toEqual([{ channelId: "ch-2", workspaceId: WS2 }]);
    });

    it("con ?w=: gana el parametro", async () => {
      world(SAME);
      await send(received(["soporte@compartido.test"]), { secret: S1, w: WS1 });
      await send(received(["soporte@compartido.test"]), { secret: S2, w: WS2 });
      expect(h.processed).toEqual([
        { channelId: "ch-1", workspaceId: WS1 },
        { channelId: "ch-2", workspaceId: WS2 },
      ]);
    });
  });
});
