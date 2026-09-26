import { describe, it, expect } from "vitest";
import { integrationStatus, needsAttention, EXPIRY_WARNING_DAYS } from "./status";
import { buildUsage } from "./usage";
import { getProvider } from "./providers";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => inDays(-d);
const zernio = getProvider("zernio")!;

describe("estado de una integracion (F2)", () => {
  it("sin fila y sin conexion esta sin conectar", () => {
    expect(integrationStatus({ now: NOW }).status).toBe("not_connected");
    expect(integrationStatus({ config: null, now: NOW }).status).toBe("not_connected");
  });

  it("una integracion desconectada a mano vuelve a sin conectar, aunque tenga un error viejo", () => {
    const result = integrationStatus({
      config: { is_active: false, last_error: "fallo hace tiempo", updated_at: daysAgo(1) },
      now: NOW,
    });

    expect(result.status).toBe("not_connected");
    expect(result.reasons).toEqual([]);
  });

  it("conectada y sin nada pendiente esta conectada", () => {
    const result = integrationStatus({ config: { is_active: true, last_error: null }, now: NOW });

    expect(result.status).toBe("connected");
    expect(result.reasons).toEqual([]);
  });

  it("un error reciente la deja en error, con el motivo a la vista", () => {
    const result = integrationStatus({
      config: { is_active: true, last_error: "La API key no es valida", updated_at: daysAgo(1) },
      now: NOW,
    });

    expect(result.status).toBe("error");
    expect(result.reasons).toEqual(["La API key no es valida"]);
  });

  it("un error de hace meses que nadie limpio no la deja en rojo para siempre", () => {
    const result = integrationStatus({
      config: { is_active: true, last_error: "fallo una vez en enero", updated_at: daysAgo(90) },
      now: NOW,
    });

    expect(result.status).toBe("connected");
  });

  it("un acceso revocado es error, no atencion", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "revoked" },
      now: NOW,
    });

    expect(result.status).toBe("error");
    expect(result.reasons[0]).toContain("volver a conectar");
  });

  it("un token vencido es error", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", token_expires_at: daysAgo(1) },
      now: NOW,
    });

    expect(result.status).toBe("error");
  });

  it("un token que vence dentro de una semana pide atencion", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", token_expires_at: inDays(EXPIRY_WARNING_DAYS - 1) },
      now: NOW,
    });

    expect(result.status).toBe("attention");
    expect(result.reasons[0]).toContain("vence en 6 dias");
  });

  it("un token que vence dentro de dos meses no molesta", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", token_expires_at: inDays(60) },
      now: NOW,
    });

    expect(result.status).toBe("connected");
  });

  it("un permiso que no se otorgo pide atencion y dice cual", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", granted_scopes: ["youtube.readonly"] },
      requiredScopes: ["youtube.readonly", "youtube.upload"],
      now: NOW,
    });

    expect(result.status).toBe("attention");
    expect(result.reasons[0]).toContain("youtube.upload");
  });

  it("si no se sabe que permisos se otorgaron, no se inventa que falta uno", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", granted_scopes: null },
      requiredScopes: ["youtube.upload"],
      now: NOW,
    });

    expect(result.status).toBe("connected");
  });

  it("llegar al tope de uso pide atencion", () => {
    const result = integrationStatus({
      config: { is_active: true },
      usage: buildUsage(zernio, 2),
      now: NOW,
    });

    expect(result.status).toBe("attention");
    expect(result.reasons[0]).toContain("2 de 2");
  });

  it("estar lejos del tope no molesta", () => {
    const result = integrationStatus({
      config: { is_active: true },
      usage: buildUsage(zernio, 1),
      now: NOW,
    });

    expect(result.status).toBe("connected");
  });

  it("varios motivos a la vez se muestran todos", () => {
    const result = integrationStatus({
      config: { is_active: true },
      connection: { status: "active", token_expires_at: inDays(2), granted_scopes: [] },
      requiredScopes: ["youtube.upload"],
      usage: buildUsage(zernio, 2),
      now: NOW,
    });

    expect(result.status).toBe("attention");
    expect(result.reasons).toHaveLength(3);
  });

  it("el filtro Requiere atencion muestra lo roto y lo que pide atencion", () => {
    expect(needsAttention("attention")).toBe(true);
    expect(needsAttention("error")).toBe(true);
    expect(needsAttention("connected")).toBe(false);
    expect(needsAttention("not_connected")).toBe(false);
  });
});
