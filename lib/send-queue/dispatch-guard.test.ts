/**
 * La cola de broadcasts con la guardia de entrega (00287): un email de marketing que excede el tope del dia NO falla.
 *
 *  - Antes de reclamar destinatarios, el carril de email consulta el cupo del dia (`email_send_capacity`): sin cupo, el
 *    carril espera hasta la hora que da la guardia y no reclama a nadie.
 *  - Con cupo, reclama solo lo que entra.
 *  - Un destinatario cuyo envio vuelve `deferred` (otro envio lleno el cupo entre medio) vuelve a `pending` para esa
 *    hora, SIN gastar intento, y el carril espera. Al dia siguiente sale.
 * Con reloj simulado y espias sobre el envio y la base.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { sendTransactionalEmail } = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail }));
vi.mock("@/lib/notifications", () => ({ notifyWorkspaceAdmins: vi.fn(async () => true) }));
vi.mock("@/lib/broadcasts/channels", () => ({
  loadBroadcastChannel: vi.fn(async () => ({
    id: "ch-email",
    kind: "email",
    label: "Email",
    policy: { minGapSeconds: 0, maxGapSeconds: 0, perMinute: 100, perHour: null, perDay: null, window: { enabled: false, days: [], start: "00:00", end: "23:59" }, pauseAfterFailures: 10 },
    connectionStatus: null,
  })),
}));
vi.mock("@/lib/broadcasts/audience-load", () => ({
  loadRenderData: vi.fn(async (_s: unknown, _w: unknown, ids: string[]) => new Map(ids.map((id) => [id, { contact: { display_name: "Ana", email: "ana@x.test", phone: null, whatsapp_phone: null }, customValues: {} }]))),
}));

import { fakeDb } from "@/lib/testing/fake-db";
import { runSendQueue, settleOutcome } from "./dispatch";

const WS = "ws-1";
const TOMORROW = new Date("2026-11-06T06:00:00Z");

const broadcast = {
  id: "b-1", workspace_id: WS, status: "sending", channel_id: "ch-email", name: "Webinar", email_subject: "Te espero el lunes",
  message_variants: ["Hola {{contact.first_name}}"], skip_missing_variables: false, pace: null, created_at: "2026-11-05T10:00:00Z",
};
const recipient = { id: "r-1", broadcast_id: "b-1", contact_id: "c-1", channel_id: "ch-email", status: "sending", attempts: 0, variant_index: 0, target: "ana@x.test" };

function world(
  capacity: Record<string, unknown>,
  recipients: unknown[] = [recipient],
  over: { audience_params?: unknown; tagged?: { data?: unknown; error?: { message: string } }; contact?: { data?: unknown; error?: { message: string } } } = {},
) {
  const queue = [...recipients];
  return fakeDb(
    {
      "broadcasts:select": { data: [{ ...broadcast, audience_params: over.audience_params ?? {} }] },
      "contact_tags:select": over.tagged ?? { data: [] },
      "channel_send_lanes:select": { data: { channel_id: "ch-email", workspace_id: WS, next_send_at: "2026-11-01T00:00:00Z", paused_at: null, consecutive_failures: 0 } },
      "workspaces:select": { data: { name: "Negocio", timezone: "America/Costa_Rica" } },
      "contacts:select": over.contact ?? { data: { id: "c-1", deleted_at: null, do_not_contact: false, is_subscribed: true, email: "ana@x.test" } },
      "custom_field_definitions:select": { data: [] },
      "broadcast_recipients:select": { data: null, count: 0 },
    },
    {
      email_send_capacity: { data: capacity },
      claim_lane_slot: { data: true },
      claim_broadcast_recipient: () => ({ data: queue.length > 0 ? [queue.shift()] : [] }),
      refresh_broadcast_counts: { data: "sending" },
    },
  );
}

const laneUpdates = (db: ReturnType<typeof world>) => db.writesTo("channel_send_lanes").map((c) => c.values as Record<string, unknown>);
/** Lo que se escribio sobre UN destinatario (el barrido de los colgados filtra por estado, no por id). */
const recipientUpdates = (db: ReturnType<typeof world>) =>
  db
    .writesTo("broadcast_recipients")
    .filter((c) => c.filters.some((f) => f.column === "id"))
    .map((c) => c.values as Record<string, unknown>);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("settleOutcome: deferred", () => {
  it("vuelve a pendiente para la hora de la guardia, sin gastar intento", () => {
    const update = settleOutcome({ kind: "deferred", reason: "daily_cap", retryAt: TOMORROW }, 2, new Date());
    expect(update).toMatchObject({ status: "pending", claimed_at: null, next_attempt_at: TOMORROW.toISOString() });
    expect(update).not.toHaveProperty("attempts");
    expect(String(update.error_message)).toMatch(/sale mañana/);
  });
});

describe("la cola de email con la guardia", () => {
  it("sin cupo hoy: el carril espera hasta manana y no reclama a nadie", async () => {
    const db = world({ status: "deferred_cap", remaining: 0, retry_at: TOMORROW.toISOString(), next_day_start: TOMORROW.toISOString() });
    await runSendQueue(db.client);
    expect(db.rpcCalls.some((c) => c.name === "claim_broadcast_recipient")).toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(laneUpdates(db)).toContainEqual({ next_send_at: TOMORROW.toISOString() });
  });

  it("con el freno puesto: tampoco reclama", async () => {
    const db = world({ status: "paused", remaining: 0, retry_at: "2026-11-05T16:00:00Z", next_day_start: TOMORROW.toISOString() });
    await runSendQueue(db.client);
    expect(db.rpcCalls.some((c) => c.name === "claim_broadcast_recipient")).toBe(false);
  });

  it("con cupo 1: reclama uno solo aunque el carril admita 100 por minuto", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const db = world({ status: "ok", remaining: 1 }, [recipient, { ...recipient, id: "r-2", contact_id: "c-2" }]);
    await runSendQueue(db.client);
    expect(db.rpcCalls.filter((c) => c.name === "claim_broadcast_recipient")).toHaveLength(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0][0]).toMatchObject({ category: "marketing", relatedEntityType: "broadcast", relatedEntityId: "b-1" });
  });

  it("si el envio vuelve deferred: el destinatario queda pendiente para manana (sin intento gastado) y manana sale", async () => {
    sendTransactionalEmail.mockResolvedValueOnce({ ok: false, reason: "deferred", defer: "daily_cap", retryAt: TOMORROW, error: "tope" });
    const db = world({ status: "ok", remaining: 5 });
    const summary = await runSendQueue(db.client);
    expect(summary.failed).toBe(0);
    const updates = recipientUpdates(db);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "pending", next_attempt_at: TOMORROW.toISOString(), claimed_at: null });
    expect(updates[0]).not.toHaveProperty("attempts");
    expect(laneUpdates(db)).toContainEqual({ next_send_at: TOMORROW.toISOString() });

    // Manana: hay cupo de nuevo y sale.
    vi.setSystemTime(new Date("2026-11-06T06:01:00Z"));
    sendTransactionalEmail.mockResolvedValueOnce({ ok: true, id: "re_2" });
    const next = world({ status: "ok", remaining: 200 }, [{ ...recipient, attempts: 0 }]);
    const after = await runSendQueue(next.client);
    expect(after.sent).toBe(1);
    expect(recipientUpdates(next)[0]).toMatchObject({ status: "sent" });
  });

  it("si la base no contesta el cupo: el carril espera unos minutos y no manda", async () => {
    const broken = fakeDb(
      {
        "broadcasts:select": { data: [broadcast] },
        "channel_send_lanes:select": { data: { channel_id: "ch-email", workspace_id: WS, next_send_at: "2026-11-01T00:00:00Z", paused_at: null, consecutive_failures: 0 } },
        "workspaces:select": { data: { name: "Negocio", timezone: "UTC" } },
      },
      { email_send_capacity: { data: null, error: { message: "boom" } } },
    );
    await runSendQueue(broken.client);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(broken.rpcCalls.some((c) => c.name === "claim_broadcast_recipient")).toBe(false);
    expect(laneUpdates(broken)).toContainEqual({ next_send_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  });
});

describe("caracterizacion: un broadcast SIN filtro de etiqueta", () => {
  it("no mira las etiquetas y manda como siempre", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const db = world({ status: "ok", remaining: 1 });
    const summary = await runSendQueue(db.client);
    expect(summary.sent).toBe(1);
    expect(db.calls.some((c) => c.table === "contact_tags")).toBe(false);
  });
});

describe("la audiencia filtrada por etiqueta se vuelve a mirar antes de mandar", () => {
  const TAG = "6f1d2c3b-1111-4222-8333-444455556666";
  const OTHER = "6f1d2c3b-1111-4222-8333-444455557777";
  const open = { status: "ok", remaining: 1 };

  it("sigue teniendo la etiqueta: se manda", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const db = world(open, [recipient], { audience_params: { tag: TAG, email: "subscribed" }, tagged: { data: [{ tag_id: TAG }] } });
    const summary = await runSendQueue(db.client);
    expect(summary.sent).toBe(1);
    const lookup = db.calls.find((c) => c.table === "contact_tags");
    expect(lookup?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "contact_id", value: "c-1" })]));
  });

  it("ya no la tiene: queda salteado con left_audience y no sale nada", async () => {
    const db = world(open, [recipient], { audience_params: { tag: TAG }, tagged: { data: [] } });
    const summary = await runSendQueue(db.client);
    expect(summary.skipped).toBe(1);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(recipientUpdates(db)[0]).toMatchObject({ status: "skipped", skip_reason: "left_audience" });
  });

  it("con varias etiquetas alcanza con tener una, como en Contactos", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const db = world(open, [recipient], { audience_params: { tag: [TAG, OTHER] }, tagged: { data: [{ tag_id: OTHER }] } });
    expect((await runSendQueue(db.client)).sent).toBe(1);
    const lookup = db.calls.find((c) => c.table === "contact_tags");
    expect(lookup?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "tag_id", value: [TAG, OTHER] })]));
  });

  it("si no se puede comprobar, no manda: es un fallo que se reintenta, no una baja de la audiencia", async () => {
    const db = world(open, [recipient], { audience_params: { tag: TAG }, tagged: { error: { message: "base caida" } } });
    await runSendQueue(db.client);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    const update = recipientUpdates(db)[0];
    expect(update.status).toBe("pending");
    expect(update.skip_reason ?? null).toBeNull();
    expect(String(update.error_message)).toContain("base caida");
  });

  it("filtrada por otra cosa: no mira las etiquetas", async () => {
    sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const db = world(open, [recipient], { audience_params: { email: "subscribed" } });
    expect((await runSendQueue(db.client)).sent).toBe(1);
    expect(db.calls.some((c) => c.table === "contact_tags")).toBe(false);
  });
});

describe("volver a leer el contacto antes de mandar", () => {
  const open = { status: "ok", remaining: 1 };

  it("si la lectura falla, no lo da por borrado: es un fallo que se reintenta", async () => {
    const db = world(open, [recipient], { contact: { data: null, error: { message: "base cargada" } } });
    const summary = await runSendQueue(db.client);
    expect(summary.skipped).toBe(0);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    const update = recipientUpdates(db)[0];
    expect(update.status).toBe("pending");
    expect(update.skip_reason ?? null).toBeNull();
    expect(String(update.error_message)).toContain("base cargada");
  });

  it("si el contacto de verdad no está (o está borrado): sigue salteado como borrado", async () => {
    for (const contact of [{ data: null }, { data: { id: "c-1", deleted_at: "2026-11-01T00:00:00Z", do_not_contact: false, is_subscribed: true, email: "ana@x.test" } }]) {
      vi.clearAllMocks();
      const db = world(open, [recipient], { contact });
      const summary = await runSendQueue(db.client);
      expect(summary.skipped).toBe(1);
      expect(sendTransactionalEmail).not.toHaveBeenCalled();
      expect(recipientUpdates(db)[0]).toMatchObject({ status: "skipped", skip_reason: "deleted" });
    }
  });
});
