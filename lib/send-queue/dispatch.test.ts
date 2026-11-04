import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RETRY_DELAYS_MS, settleOutcome } from "./dispatch";

const now = new Date("2026-11-03T13:00:00.000Z");

describe("settleOutcome: cómo queda un destinatario después de un intento", () => {
  it("enviado", () => {
    expect(settleOutcome({ kind: "sent", conversationId: "c1" }, 0, now)).toEqual({
      status: "sent",
      sent_at: now.toISOString(),
      conversation_id: "c1",
      error_message: null,
      next_attempt_at: null,
    });
  });

  it("un fallo pasajero se reintenta a 1, 5 y 15 minutos, y después queda fallido", () => {
    const fail = { kind: "failed" as const, message: "no contestó", retryable: true };
    for (let attempts = 0; attempts < RETRY_DELAYS_MS.length; attempts++) {
      const u = settleOutcome(fail, attempts, now);
      expect(u.status).toBe("pending");
      expect(u.attempts).toBe(attempts + 1);
      expect(u.claimed_at).toBeNull();
      expect(new Date(u.next_attempt_at!).getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[attempts]);
    }
    expect(settleOutcome(fail, RETRY_DELAYS_MS.length, now)).toMatchObject({ status: "failed", attempts: RETRY_DELAYS_MS.length + 1 });
  });

  it("un fallo definitivo no se reintenta", () => {
    expect(settleOutcome({ kind: "failed", message: "x", retryable: false }, 0, now)).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("el tope del canal no gasta intento", () => {
    const u = settleOutcome({ kind: "rate_limited" }, 2, now);
    expect(u.status).toBe("pending");
    expect(u.attempts).toBeUndefined();
  });

  it("salteado, con su motivo", () => {
    expect(settleOutcome({ kind: "skipped", reason: "do_not_contact" }, 0, now)).toMatchObject({ status: "skipped", skip_reason: "do_not_contact" });
  });
});

describe("frontera: un broadcast sale solo por los caminos de siempre", () => {
  const src = readFileSync(join(__dirname, "dispatch.ts"), "utf8");

  it("WhatsApp por sendChannelMessage (rama por proveedor + tope de 200/h) y email por sendTransactionalEmail como marketing", () => {
    expect(src).toContain("sendChannelMessage(");
    expect(src).toContain("sendTransactionalEmail(");
    expect(src).toMatch(/category:\s*"marketing"/);
    expect(src).not.toMatch(/evolution-client|zernio-client|sendEvolutionDirect|sendViaResend/);
  });
});
