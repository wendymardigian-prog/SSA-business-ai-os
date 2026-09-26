import { describe, it, expect } from "vitest";
import {
  planRefresh,
  warnMessage,
  type ConnectionToCheck,
  REFRESH_WHEN_DAYS_LEFT,
} from "./token-refresh";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

const conn = (over: Partial<ConnectionToCheck> = {}): ConnectionToCheck => ({
  id: "c1",
  workspaceId: "ws-1",
  provider: "threads",
  status: "active",
  tokenExpiresAt: inDays(60),
  canRefresh: true,
  ...over,
});

describe("que hacer con cada conexion (F12, F15)", () => {
  it("con tiempo de sobra no se toca", () => {
    expect(planRefresh(conn({ tokenExpiresAt: inDays(30) }), NOW)).toEqual({
      kind: "skip",
      reason: "not_due",
    });
  });

  it("faltando menos de 15 dias se renueva, si el proveedor deja", () => {
    expect(planRefresh(conn({ tokenExpiresAt: inDays(14) }), NOW)).toEqual({ kind: "refresh" });
    expect(REFRESH_WHEN_DAYS_LEFT).toBe(15);
  });

  it("si no se puede renovar, se avisa recien a los 7 dias", () => {
    // Avisar con 15 dias de algo que no se puede renovar solo es ruido.
    const linkedin = (d: number) =>
      planRefresh(conn({ provider: "linkedin", canRefresh: false, tokenExpiresAt: inDays(d) }), NOW);

    expect(linkedin(14)).toEqual({ kind: "skip", reason: "not_due" });
    expect(linkedin(5)).toEqual({ kind: "warn", daysLeft: 5, expired: false });
  });

  it("un token ya vencido se avisa como vencido", () => {
    const action = planRefresh(
      conn({ provider: "linkedin", canRefresh: false, tokenExpiresAt: inDays(-2) }),
      NOW,
    );

    expect(action).toMatchObject({ kind: "warn", expired: true });
    expect(warnMessage("LinkedIn", action as never)).toContain("vencio");
  });

  it("una conexion revocada no se renueva ni se vuelve a avisar cada semana", () => {
    expect(planRefresh(conn({ status: "revoked", tokenExpiresAt: inDays(1) }), NOW)).toEqual({
      kind: "skip",
      reason: "revoked",
    });
  });

  it("sin fecha de vencimiento no hay nada que planificar", () => {
    expect(planRefresh(conn({ tokenExpiresAt: null }), NOW)).toEqual({
      kind: "skip",
      reason: "no_expiry",
    });
    expect(planRefresh(conn({ tokenExpiresAt: "no es una fecha" }), NOW).kind).toBe("skip");
  });

  it("el aviso dice que hacer, no solo que pasa", () => {
    expect(warnMessage("LinkedIn", { kind: "warn", daysLeft: 5, expired: false })).toContain(
      "Reconectalo",
    );
    expect(warnMessage("LinkedIn", { kind: "warn", daysLeft: 0, expired: false })).toContain("hoy");
  });

  it("una conexion en atencion igual se renueva si se puede", () => {
    expect(planRefresh(conn({ status: "attention", tokenExpiresAt: inDays(3) }), NOW)).toEqual({
      kind: "refresh",
    });
  });
});
