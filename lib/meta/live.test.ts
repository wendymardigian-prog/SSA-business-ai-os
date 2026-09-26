/**
 * Los datos en vivo con cache (F58).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  breakdownKeyOf,
  cacheKey,
  clearLiveCache,
  fetchBreakdown,
  fetchUniqueReach,
  liveQuery,
  readCache,
  writeCache,
} from "./live";

beforeEach(() => clearLiveCache());

const respond = (body: unknown) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

describe("la clave de cache (F58)", () => {
  it("incluye cuenta, tipo, objeto y periodo", () => {
    // Sin el objeto, abrir dos campañas mostraria los datos de la primera.
    const a = cacheKey({ adAccountId: "act_1", kind: "reach", objectId: "c1", since: "a", until: "b" });
    const b = cacheKey({ adAccountId: "act_1", kind: "reach", objectId: "c2", since: "a", until: "b" });

    expect(a).not.toBe(b);
  });

  it("cambiar el periodo cambia la clave", () => {
    const a = cacheKey({ adAccountId: "act_1", kind: "reach", objectId: "c1", since: "a", until: "b" });
    const b = cacheKey({ adAccountId: "act_1", kind: "reach", objectId: "c1", since: "a", until: "c" });

    expect(a).not.toBe(b);
  });
});

describe("la cache (F58)", () => {
  it("devuelve lo guardado dentro de los 15 minutos", () => {
    writeCache("k", { value: 1 }, 1000);

    expect(readCache("k", 1000 + 14 * 60_000)).toEqual({ value: 1 });
  });

  it("pasados los 15 minutos, no", () => {
    writeCache("k", { value: 1 }, 1000);

    expect(readCache("k", 1000 + 16 * 60_000)).toBeNull();
  });

  it("una clave que nunca se guardo devuelve null", () => {
    expect(readCache("no-existe")).toBeNull();
  });
});

describe("pedir con cache (F58)", () => {
  it("dos pedidos iguales en 15 minutos llaman a Meta una sola vez", () => {
    const fetchImpl = respond({ data: [{ reach: "5000" }] });

    return (async () => {
      const first = await liveQuery({ key: "k", token: "t", path: "act_1/insights", query: {}, fetchImpl });
      const second = await liveQuery({ key: "k", token: "t", path: "act_1/insights", query: {}, fetchImpl });

      expect(first).toMatchObject({ ok: true, fromCache: false });
      expect(second).toMatchObject({ ok: true, fromCache: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    })();
  });

  it("un error no se guarda en la cache", async () => {
    // Si no, un error de un segundo quedaria quince minutos.
    const fetchImpl = respond({ error: { code: 100, message: "nope" } });

    const result = await liveQuery({ key: "k", token: "t", path: "x", query: {}, fetchImpl });

    expect(result.ok).toBe(false);
    expect(readCache("k")).toBeNull();
  });
});

describe("el alcance unico (F58)", () => {
  it("se pide SIN partir por dia", async () => {
    // El alcance del periodo no es la suma de los diarios: la misma persona
    // alcanzada dos dias cuenta una vez.
    const fetchImpl = respond({ data: [{ reach: "8000", frequency: "1.25", impressions: "10000" }] });

    const result = await fetchUniqueReach({
      token: "t",
      adAccountId: "act_1",
      since: "2026-09-01",
      until: "2026-10-01",
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: true, data: { reach: 8000, frequency: 1.25 } });
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).not.toContain("time_increment");
  });

  it("sin filas, los tres valores en null", async () => {
    const result = await fetchUniqueReach({
      token: "t",
      adAccountId: "act_1",
      since: "a",
      until: "b",
      fetchImpl: respond({ data: [] }),
    });

    expect(result.ok && result.data.reach).toBeNull();
  });
});

describe("los desgloses (F58)", () => {
  it("edad y genero salen con etiqueta en castellano", () => {
    expect(breakdownKeyOf({ age: "25-34", gender: "female" }, "age,gender")).toBe("25-34 · Mujeres");
    expect(breakdownKeyOf({ age: "25-34", gender: "unknown" }, "age,gender")).toContain("Sin especificar");
  });

  it("el placement y el dispositivo salen tal cual", () => {
    expect(breakdownKeyOf({ publisher_platform: "instagram" }, "publisher_platform")).toBe("instagram");
    expect(breakdownKeyOf({ impression_device: "iphone" }, "impression_device")).toBe("iphone");
  });

  it("trae las filas con sus metricas", async () => {
    const result = await fetchBreakdown({
      token: "t",
      adAccountId: "act_1",
      breakdown: "publisher_platform",
      since: "a",
      until: "b",
      fetchImpl: respond({
        data: [{ publisher_platform: "instagram", spend: "100", clicks: "50", ctr: "3.2" }],
      }),
    });

    expect(result.ok && result.data[0]).toMatchObject({ key: "instagram", spend: 100, ctr: 3.2 });
  });

  it("si un desglose falla, devuelve el error y no rompe a los demas", async () => {
    const result = await fetchBreakdown({
      token: "t",
      adAccountId: "act_1",
      breakdown: "age,gender",
      since: "a",
      until: "b",
      fetchImpl: respond({ error: { code: 100, message: "no disponible" } }),
    });

    expect(result).toMatchObject({ ok: false });
  });
});
