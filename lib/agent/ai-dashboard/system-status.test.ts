import { describe, it, expect } from "vitest";
import { computeSystemStatus, systemStatusDetails } from "./system-status";

describe("computeSystemStatus", () => {
  it("sin nada raro, todo bien", () => {
    const s = computeSystemStatus({ runsLast24h: 20, errorsLast24h: 0, integrationStatuses: ["connected", "connected"], missingPricing: 0 });
    expect(s.level).toBe("ok");
  });

  it("sin ninguna corrida en 24 h, es verde con la nota, nunca rojo", () => {
    const s = computeSystemStatus({ runsLast24h: 0, errorsLast24h: 0, integrationStatuses: [], missingPricing: 0 });
    expect(s.level).toBe("ok");
    expect(s.noActivity).toBe(true);
    expect(s.errorRatePct).toBeNull();
  });

  it("hay errores en 24h pero no pasan el 10%: amarillo, revisar", () => {
    const s = computeSystemStatus({ runsLast24h: 20, errorsLast24h: 1, integrationStatuses: [], missingPricing: 0 }); // 5%
    expect(s.level).toBe("warning");
  });

  it("mas del 10% de corridas con error: rojo", () => {
    const s = computeSystemStatus({ runsLast24h: 20, errorsLast24h: 3, integrationStatuses: [], missingPricing: 0 }); // 15%
    expect(s.level).toBe("critical");
    expect(s.errorRatePct).toBeCloseTo(15);
  });

  it("una integracion 'Requiere atención' pone la tarjeta en amarillo", () => {
    const s = computeSystemStatus({ runsLast24h: 10, errorsLast24h: 0, integrationStatuses: ["attention"], missingPricing: 0 });
    expect(s.level).toBe("warning");
    expect(s.attentionIntegrations).toBe(1);
  });

  it("una integracion 'Con error' pone la tarjeta en rojo, aunque las corridas esten bien", () => {
    const s = computeSystemStatus({ runsLast24h: 10, errorsLast24h: 0, integrationStatuses: ["error"], missingPricing: 0 });
    expect(s.level).toBe("critical");
  });

  it("corridas sin precio ponen la tarjeta en amarillo", () => {
    const s = computeSystemStatus({ runsLast24h: 10, errorsLast24h: 0, integrationStatuses: [], missingPricing: 2 });
    expect(s.level).toBe("warning");
    expect(s.missingPricing).toBe(2);
  });

  it("not_connected no cuenta como señal: una integracion nunca conectada no es un problema nuevo", () => {
    const s = computeSystemStatus({ runsLast24h: 10, errorsLast24h: 0, integrationStatuses: ["not_connected", "not_connected"], missingPricing: 0 });
    expect(s.level).toBe("ok");
  });
});

describe("systemStatusDetails", () => {
  it("nombra la cantidad exacta de corridas con error y el porcentaje", () => {
    const s = computeSystemStatus({ runsLast24h: 20, errorsLast24h: 3, integrationStatuses: [], missingPricing: 0 });
    expect(systemStatusDetails(s).join(" ")).toContain("3 corridas con error en las últimas 24 h (15 % de las corridas)");
  });

  it("dice explicitamente que no hay señal de latido del worker", () => {
    const s = computeSystemStatus({ runsLast24h: 0, errorsLast24h: 0, integrationStatuses: [], missingPricing: 0 });
    expect(systemStatusDetails(s).some((l) => l.includes("latido del worker"))).toBe(true);
  });

  it("sin corridas en 24h, no dice 'sin errores': dice que no hubo actividad", () => {
    const s = computeSystemStatus({ runsLast24h: 0, errorsLast24h: 0, integrationStatuses: [], missingPricing: 0 });
    expect(systemStatusDetails(s)[0]).toBe("Sin actividad en 24 h.");
  });
});
