import { describe, it, expect } from "vitest";
import { routingSentence } from "./routing-sentence";
import { refreshHealth, shouldAlertRefreshHealth } from "./refresh-health";

describe("routingSentence (F12)", () => {
  it("ya respondida en el momento 1", () => {
    expect(routingSentence({ check: "already_answered", moment: 1 })).toMatch(/antes de generar/);
  });
  it("ya respondida en el momento 2", () => {
    expect(routingSentence({ check: "already_answered", moment: 2 })).toMatch(/mientras se generaba/);
  });
  it("espera externa", () => {
    expect(routingSentence({ check: "external_cooldown" })).toMatch(/ManyChat/);
  });
  it("regla que envía directo, con nombre", () => {
    const s = routingSentence({ mode: "rules", action: "send", rule_id: "r9", rule_index: 8 }, new Map([["r9", { name: "mensaje corto", index: 8 }]]));
    expect(s).toBe("Se envió directo por la regla 9: mensaje corto.");
  });
  it("regla que deja borrador, sin lookup usa el índice", () => {
    expect(routingSentence({ mode: "rules", action: "draft", rule_id: "r3", rule_index: 2 })).toBe("Quedó como borrador por la regla 3.");
  });
  it("acción por defecto de las reglas", () => {
    expect(routingSentence({ mode: "rules", action: "draft", rule_id: null })).toMatch(/acción por defecto/);
  });
  it("modo directo y borrador simples", () => {
    expect(routingSentence({ mode: "send" })).toBe("Se envió directo.");
    expect(routingSentence({ mode: "draft" })).toBe("Quedó como borrador.");
  });
  it("nunca muestra el código rule:", () => {
    const s = routingSentence({ mode: "rules", action: "skip", rule_id: "r1", rule_index: 0 }, new Map([["r1", { name: "botón conocido", index: 0 }]]));
    expect(s).not.toMatch(/rule:/);
  });
});

describe("refreshHealth (F12)", () => {
  it("cuenta sólo runs que refrescaron", () => {
    const h = refreshHealth([{ refresh: "ok" }, { refresh: "failed" }, {}, null, { refresh: "ok" }]);
    expect(h.total).toBe(3);
    expect(h.failed).toBe(1);
    expect(h.failedPct).toBeCloseTo(33.3, 1);
  });
  it("avisa sólo con volumen y sobre el umbral", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ refresh: i < 3 ? "failed" : "ok" }));
    expect(shouldAlertRefreshHealth(refreshHealth(many))).toBe(true); // 3/40 = 7.5% > 5
    const few = [{ refresh: "failed" }, { refresh: "ok" }];
    expect(shouldAlertRefreshHealth(refreshHealth(few))).toBe(false); // sin volumen
  });
});
