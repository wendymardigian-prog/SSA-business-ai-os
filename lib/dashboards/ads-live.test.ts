/**
 * Lo que el dashboard de Meta Ads y Anuncios piden en vivo, como promesas que no rechazan.
 */

import { describe, expect, it, vi } from "vitest";
import { accountReachOf, neverRejects, previousReachOf } from "./ads-live";

describe("el alcance en vivo", () => {
  it("con respuesta de Meta, el alcance y la frecuencia de esa respuesta", () => {
    const live = { ok: true as const, fromCache: false, data: { reach: 8000, frequency: 1.25, impressions: 10000 } };

    expect(accountReachOf(live)).toEqual({ uniqueReach: 8000, uniqueFrequency: 1.25, liveError: null });
    expect(previousReachOf(live)).toMatchObject({ reach: 8000, frequency: 1.25 });
  });

  it("si Meta no lo dio, null y el motivo (nunca un cero)", () => {
    expect(accountReachOf({ ok: false, error: "Meta tardó demasiado" })).toEqual({
      uniqueReach: null,
      uniqueFrequency: null,
      liveError: "Meta tardó demasiado",
    });
    expect(previousReachOf({ ok: false, error: "x" })).toBeNull();
  });

  it("sin consulta (sin token o sin periodo), null y sin aviso", () => {
    expect(accountReachOf(null)).toEqual({ uniqueReach: null, uniqueFrequency: null, liveError: null });
  });
});

describe("las promesas que lee use()", () => {
  it("lo que resuelve pasa tal cual", async () => {
    await expect(neverRejects(Promise.resolve(3), "algo", () => 0)).resolves.toBe(3);
  });

  it("lo que rechaza se convierte en el valor de respaldo, con el motivo", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await neverRejects(Promise.reject(new Error("se cayo")), "el CRM", (message) => ({ error: message }));

    expect(result).toEqual({ error: "se cayo" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
