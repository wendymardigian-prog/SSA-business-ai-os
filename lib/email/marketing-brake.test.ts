/**
 * El freno automatico del marketing (automatizaciones de email, Fase 1a, A6).
 *
 * Con al menos 50 de marketing enviados en 24 h: rebotes por encima del 2 % o quejas por encima del 0,05 % pausan TODO
 * el marketing del negocio y avisan. Los transaccionales siguen (la guardia no los mira). Se reanuda a mano.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

const { createNotificationOnce } = vi.hoisted(() => ({ createNotificationOnce: vi.fn(async () => true) }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationOnce, createNotification: vi.fn(async () => true) }));
const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn(async () => "a-1") }));
vi.mock("@/lib/audit", () => ({ logAudit }));

import { brakeDecision, evaluateMarketingBrake, resumeMarketing, BRAKE_MIN_SENT } from "./marketing-brake";
import { decideEmailSend } from "./delivery-guard";
import { fakeDb, type DbCall } from "@/lib/testing/fake-db";
import { sendTransactionalEmail } from "./send";

const WS = "11111111-1111-1111-1111-111111111111";

afterEach(() => vi.clearAllMocks());

describe("brakeDecision (puro)", () => {
  it("con menos de 50 enviados no se calcula, aunque todo rebote", () => {
    expect(brakeDecision({ sent: BRAKE_MIN_SENT - 1, bounced: 49, complained: 10 })).toMatchObject({ trip: false, bounceRate: null });
  });

  it("2 % de rebotes justo no frena; por encima, si", () => {
    expect(brakeDecision({ sent: 100, bounced: 2, complained: 0 }).trip).toBe(false);
    expect(brakeDecision({ sent: 100, bounced: 3, complained: 0 })).toMatchObject({ trip: true, reason: "bounces" });
  });

  it("una queja sobre 50 ya pasa el 0,05 %", () => {
    expect(brakeDecision({ sent: 50, bounced: 0, complained: 1 })).toMatchObject({ trip: true, reason: "complaints" });
  });

  it("0,05 % de quejas justo no frena (1 en 2000)", () => {
    expect(brakeDecision({ sent: 2000, bounced: 0, complained: 1 }).trip).toBe(false);
    expect(brakeDecision({ sent: 2000, bounced: 0, complained: 2 }).trip).toBe(true);
  });
});

/** Un negocio con estas cuentas de 24 h. */
function world(stats: { sent: number; bounced: number; complained: number }, config: Record<string, unknown> = {}) {
  const countOf = (call: DbCall) => {
    const hasNot = (col: string) => call.filters.some((f) => f.method === "not" && f.column === col);
    if (hasNot("bounced_at")) return stats.bounced;
    if (hasNot("complained_at")) return stats.complained;
    return stats.sent;
  };
  return fakeDb(
    {
      "email_log:select": (call) => ({ data: null, count: countOf(call) }),
      "integration_configs:select": { data: { config } },
    },
    { patch_resend_config: { data: true } },
  );
}

describe("evaluateMarketingBrake", () => {
  it("supera el limite: pausa el marketing, guarda el motivo, avisa y queda en el historial", async () => {
    const db = world({ sent: 100, bounced: 3, complained: 0 });
    const now = new Date("2026-11-05T15:00:00Z");
    expect(await evaluateMarketingBrake(db.client, WS, now)).toBe(true);
    const patch = db.rpcCalls.find((c) => c.name === "patch_resend_config")!.args as { p_patch: Record<string, unknown> };
    expect(patch.p_patch).toMatchObject({ marketing_paused_at: now.toISOString(), marketing_last_brake_at: now.toISOString() });
    expect(String(patch.p_patch.marketing_paused_reason)).toContain("Rebotaron 3 de 100");
    expect(createNotificationOnce).toHaveBeenCalledWith(expect.objectContaining({ type: "email_marketing_paused", workspaceId: WS }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "email_marketing.paused", actorType: "system" }));
  });

  it("dentro del limite: no toca nada", async () => {
    const db = world({ sent: 100, bounced: 2, complained: 0 });
    expect(await evaluateMarketingBrake(db.client, WS)).toBe(false);
    expect(db.rpcCalls).toEqual([]);
    expect(createNotificationOnce).not.toHaveBeenCalled();
  });

  it("ya pausado: no vuelve a pausar ni a avisar", async () => {
    const db = world({ sent: 100, bounced: 10, complained: 0 }, { marketing_paused_at: "2026-11-05T10:00:00Z" });
    expect(await evaluateMarketingBrake(db.client, WS)).toBe(false);
    expect(db.rpcCalls).toEqual([]);
    expect(createNotificationOnce).not.toHaveBeenCalled();
  });

  it("si no se puede contar, no pausa (y no lanza)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ "email_log:select": { data: null, error: { message: "boom" } } });
    expect(await evaluateMarketingBrake(db.client, WS)).toBe(false);
  });
});

describe("reanudar a mano", () => {
  it("borra la pausa (no el registro del ultimo freno) y queda quien lo reanudo", async () => {
    const db = world({ sent: 0, bounced: 0, complained: 0 });
    expect(await resumeMarketing(db.client, WS, "user-1")).toEqual({ ok: true });
    const patch = db.rpcCalls.find((c) => c.name === "patch_resend_config")!.args as { p_patch: Record<string, unknown> };
    expect(patch.p_patch).toEqual({ marketing_paused_at: null, marketing_paused_reason: null, marketing_paused_stats: null });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "email_marketing.resumed", performedBy: "user-1" }));
  });
});

describe("con el freno puesto, lo transaccional sigue", () => {
  it("la decision: marketing pausado, transaccional ok", () => {
    const base = { today: "2026-11-05", manual_cap: 1000, warmup_enabled: false, paused: true, marketing_today: 0 } as const;
    expect(decideEmailSend({ ...base, category: "marketing" }).status).toBe("paused");
    expect(decideEmailSend({ ...base, category: "transactional" }).status).toBe("ok");
  });

  it("de punta a punta: el marketing no llega a Resend; la confirmacion de una reunion si", async () => {
    const db = fakeDb(
      {
        "integration_configs:select": { data: { config: { from_email: "hola@n.test", marketing_paused_at: "2026-11-05T10:00:00Z" }, is_active: true } },
        "email_log:insert": { data: null },
      },
      {
        read_secret: { data: "re_key" },
        email_address_send_state: { data: { status: "subscribed", do_not_contact: false, token: "t", matched: true } },
        reserve_email_send: { data: { status: "paused", retry_at: "2026-11-05T16:00:00Z" } },
      },
    );
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    const params = { workspaceId: WS, to: "ana@x.test", subject: "Hola", html: "<p>x</p>", kind: "flow", deps: { supabase: db.client, fetchImpl } };
    const marketing = await sendTransactionalEmail({ ...params, category: "marketing" });
    expect(marketing).toMatchObject({ ok: false, reason: "deferred", defer: "paused" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const transactional = await sendTransactionalEmail({ ...params, category: "transactional" });
    expect(transactional).toEqual({ ok: true, id: "re_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
