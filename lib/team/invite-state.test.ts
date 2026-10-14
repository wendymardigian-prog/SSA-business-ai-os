import { describe, expect, it } from "vitest";
import {
  canResend,
  deliveryChip,
  inviteIsOpen,
  inviteState,
  invalidInviteMessage,
  MAX_SENDS,
  renewedExpiry,
  RESEND_COOLDOWN_SECONDS,
} from "./invite-state";

const now = new Date("2026-10-13T12:00:00Z");
const future = "2026-10-20T12:00:00Z";
const past = "2026-10-12T12:00:00Z";

describe("inviteState", () => {
  it("pendiente vigente, vencida, aceptada y anulada", () => {
    expect(inviteState({ status: "pending", expires_at: future }, now)).toBe("pending");
    expect(inviteState({ status: "pending", expires_at: past }, now)).toBe("expired");
    expect(inviteState({ status: "accepted", expires_at: past }, now)).toBe("accepted");
    expect(inviteState({ status: "revoked", expires_at: future }, now)).toBe("revoked");
  });

  it("sin vencimiento no vence", () => {
    expect(inviteState({ status: "pending", expires_at: null }, now)).toBe("pending");
  });

  it("solo una pendiente vigente se puede abrir", () => {
    expect(inviteIsOpen({ status: "pending", expires_at: future }, now)).toBe(true);
    expect(inviteIsOpen({ status: "pending", expires_at: past }, now)).toBe(false);
    expect(inviteIsOpen({ status: "revoked", expires_at: future }, now)).toBe(false);
  });
});

describe("canResend", () => {
  const base = { status: "pending", expires_at: future, send_count: 1, last_sent_at: "2026-10-13T11:00:00Z" };

  it("deja reenviar pasado el minuto", () => {
    expect(canResend(base, now)).toEqual({ ok: true });
  });

  it("rechaza si pasaron menos de 60 segundos", () => {
    const r = canResend({ ...base, last_sent_at: new Date(now.getTime() - 30_000).toISOString() }, now);
    expect(r).toMatchObject({ ok: false, reason: "too_soon", waitSeconds: 30 });
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it("rechaza al llegar a 5 envíos", () => {
    expect(canResend({ ...base, send_count: MAX_SENDS }, now)).toMatchObject({ ok: false, reason: "limit" });
    expect(canResend({ ...base, send_count: MAX_SENDS - 1 }, now)).toEqual({ ok: true });
  });

  it("no reenvía una aceptada ni una anulada, pero sí una vencida (se renueva aparte)", () => {
    expect(canResend({ ...base, status: "accepted" }, now)).toMatchObject({ ok: false, reason: "not_open" });
    expect(canResend({ ...base, status: "revoked" }, now)).toMatchObject({ ok: false, reason: "not_open" });
    expect(canResend({ ...base, expires_at: past }, now)).toEqual({ ok: true });
  });

  it("una que nunca se mandó se puede mandar ya", () => {
    expect(canResend({ ...base, send_count: 0, last_sent_at: null }, now)).toEqual({ ok: true });
  });
});

describe("renovar y mostrar", () => {
  it("renovar pone el vencimiento a 7 días desde ahora", () => {
    expect(renewedExpiry(now)).toBe("2026-10-20T12:00:00.000Z");
  });

  it("el chip dice cómo se mandó y cómo salió", () => {
    expect(deliveryChip({ delivery: "link", email_status: null })).toEqual({ label: "Solo link", tone: "neutral" });
    expect(deliveryChip({ delivery: "email", email_status: "sent" }).label).toBe("Email enviado");
    expect(deliveryChip({ delivery: "email", email_status: "failed" })).toEqual({ label: "Email falló", tone: "warn" });
    expect(deliveryChip({ delivery: "email", email_status: "not_configured" }).tone).toBe("warn");
    expect(deliveryChip({ delivery: "email", email_status: null }).label).toBe("Email");
  });

  it("el mensaje de una invitación que ya no sirve; la vencida agrega qué hacer", () => {
    expect(invalidInviteMessage("revoked")).toEqual({ title: "Esta invitación ya no es válida", hint: null });
    expect(invalidInviteMessage("accepted").hint).toBeNull();
    expect(invalidInviteMessage("expired").hint).toContain("renueve");
  });
});
