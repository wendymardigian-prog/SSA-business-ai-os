/**
 * La guardia unica de entrega (automatizaciones de email, Fase 1a, A6).
 *
 *  - `decideEmailSend` (TS) con los casos de `delivery-guard.cases.json`; los MISMOS casos corren contra
 *    `private.email_guard_decide` (SQL) en `scripts/verify-email-subscription.mjs`.
 *  - `reserveEmailSend`: como lee lo que contesta la base; si la base no contesta, el marketing espera (nunca sale a
 *    ciegas pasando el tope).
 *  - `sendTransactionalEmail`: un email de marketing que no entra vuelve `deferred` SIN llegar a Resend ni dejar fila;
 *    uno que entra cierra SU reserva (no inserta otra) y lleva `?e=` en la baja; lo transaccional nunca reserva.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import cases from "./delivery-guard.cases.json";
import { decideEmailSend, reserveEmailSend, DEFER_MESSAGES, GUARD_UNAVAILABLE_RETRY_MS, type GuardInput } from "./delivery-guard";
import { fakeDb } from "@/lib/testing/fake-db";
import { sendTransactionalEmail } from "./send";

const WS = "11111111-1111-1111-1111-111111111111";
const LOG = "33333333-3333-3333-3333-333333333333";

afterEach(() => vi.restoreAllMocks());

describe("decideEmailSend: los casos compartidos con la base", () => {
  for (const c of cases as Array<{ name: string; input: GuardInput; expected: Record<string, unknown> }>) {
    it(c.name, () => {
      expect(decideEmailSend(c.input)).toMatchObject(c.expected);
    });
  }

  it("cubre los cuatro resultados", () => {
    const seen = new Set((cases as Array<{ input: GuardInput }>).map((c) => decideEmailSend(c.input).status));
    expect([...seen].sort()).toEqual(["deferred_cap", "deferred_quota", "ok", "paused"]);
  });
});

describe("reserveEmailSend", () => {
  const params = { workspaceId: WS, to: "ana@x.test", subject: "Hola", kind: "broadcast" };

  it("con lugar: devuelve el id de la reserva", async () => {
    const db = fakeDb({}, { reserve_email_send: { data: { status: "ok", log_id: LOG } } });
    expect(await reserveEmailSend(db.client, params)).toEqual({ ok: true, logId: LOG });
  });

  it("tope del dia: queda para el inicio del dia siguiente del negocio", async () => {
    const db = fakeDb({}, { reserve_email_send: { data: { status: "deferred_cap", retry_at: "2026-11-06T06:00:00+00:00", cap: 100, used_today: 100 } } });
    const res = await reserveEmailSend(db.client, params);
    expect(res).toEqual({ ok: false, reason: "daily_cap", retryAt: new Date("2026-11-06T06:00:00Z"), message: DEFER_MESSAGES.daily_cap });
  });

  it("cuota del plan y freno: su motivo", async () => {
    const quota = fakeDb({}, { reserve_email_send: { data: { status: "deferred_quota", retry_at: "2026-11-06T06:00:00Z" } } });
    expect(await reserveEmailSend(quota.client, params)).toMatchObject({ ok: false, reason: "quota" });
    const paused = fakeDb({}, { reserve_email_send: { data: { status: "paused", retry_at: "2026-11-05T20:00:00Z" } } });
    expect(await reserveEmailSend(paused.client, params)).toMatchObject({ ok: false, reason: "paused", retryAt: new Date("2026-11-05T20:00:00Z") });
  });

  it("la base no contesta: el marketing espera 15 minutos (no sale a ciegas)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const now = new Date("2026-11-05T15:00:00Z");
    const db = fakeDb({}, { reserve_email_send: { data: null, error: { message: "boom" } } });
    expect(await reserveEmailSend(db.client, params, now)).toEqual({
      ok: false,
      reason: "unavailable",
      retryAt: new Date(now.getTime() + GUARD_UNAVAILABLE_RETRY_MS),
      message: DEFER_MESSAGES.unavailable,
    });
  });
});

function world(reserve: Record<string, unknown> | null) {
  return fakeDb(
    {
      "integration_configs:select": { data: { config: { from_email: "hola@negocio.test", from_name: "Negocio" }, is_active: true, vault_secret_name: null } },
      "email_log:insert": { data: null },
      "email_log:update": { data: null },
    },
    {
      read_secret: { data: "re_key" },
      email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "tok-1", matched: true } },
      ...(reserve ? { reserve_email_send: { data: reserve } } : {}),
    },
  );
}

function send(db: ReturnType<typeof world>, category: "marketing" | "transactional", fetchImpl: typeof fetch) {
  return sendTransactionalEmail({
    workspaceId: WS,
    to: "ana@x.test",
    subject: "Hola",
    html: "<p>Hola</p>",
    kind: "broadcast",
    contactId: "22222222-2222-2222-2222-222222222222",
    category,
    deps: { supabase: db.client, fetchImpl },
  });
}

describe("sendTransactionalEmail con la guardia", () => {
  const okFetch = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));

  it("marketing que no entra: deferred con su hora, sin llegar a Resend y sin fila en email_log", async () => {
    const db = world({ status: "deferred_cap", retry_at: "2026-11-06T06:00:00Z" });
    const fetchImpl = okFetch();
    const res = await send(db, "marketing", fetchImpl);
    expect(res).toEqual({ ok: false, reason: "deferred", defer: "daily_cap", retryAt: new Date("2026-11-06T06:00:00Z"), error: DEFER_MESSAGES.daily_cap });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.writesTo("email_log")).toEqual([]);
  });

  it("marketing que entra: cierra SU reserva (update, no insert) y la baja lleva ?e=", async () => {
    const db = world({ status: "ok", log_id: LOG });
    const fetchImpl = okFetch();
    expect(await send(db, "marketing", fetchImpl)).toEqual({ ok: true, id: "re_1" });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(body.headers["List-Unsubscribe"]).toContain(`?e=${LOG}`);
    expect(body.html).toContain(`?e=${LOG}`);
    const writes = db.writesTo("email_log");
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
    expect(writes[0].values).toMatchObject({ status: "sent", provider_message_id: "re_1" });
    expect(writes[0].filters).toEqual(expect.arrayContaining([{ method: "eq", column: "id", value: LOG }, { method: "eq", column: "status", value: "reserved" }]));
  });

  it("transaccional: nunca reserva ni espera (aunque el marketing este lleno o pausado) y queda con su categoria", async () => {
    const db = world({ status: "paused" });
    const fetchImpl = okFetch();
    expect(await send(db, "transactional", fetchImpl)).toEqual({ ok: true, id: "re_1" });
    expect(db.rpcCalls.some((c) => c.name === "reserve_email_send")).toBe(false);
    expect(db.writesTo("email_log")[0].values).toMatchObject({ status: "sent", category: "transactional" });
  });

  it("un email al equipo (sin categoria) tampoco pasa por la guardia", async () => {
    const db = world({ status: "paused" });
    const fetchImpl = okFetch();
    const res = await sendTransactionalEmail({ workspaceId: WS, to: "equipo@x.test", subject: "Aviso", html: "<p>x</p>", kind: "team_invite", deps: { supabase: db.client, fetchImpl } });
    expect(res.ok).toBe(true);
    expect(db.rpcCalls.some((c) => c.name === "reserve_email_send")).toBe(false);
  });
});
