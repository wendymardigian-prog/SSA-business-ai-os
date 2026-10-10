/**
 * Los datos en vivo con cache (F58).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  breakdownKeyOf,
  cacheKey,
  clearLiveCache,
  fetchBreakdown,
  fetchReachByLevel,
  fetchUniqueReach,
  liveQuery,
  parseHour,
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

  it("placement y posicion van juntos, y cada dimension en su campo", async () => {
    const result = await fetchBreakdown({
      token: "t",
      adAccountId: "act_1",
      breakdown: "publisher_platform,platform_position",
      since: "a",
      until: "b",
      fetchImpl: respond({
        data: [{ publisher_platform: "instagram", platform_position: "feed", spend: "10", reach: "800" }],
      }),
    });

    expect(result.ok && result.data[0]).toMatchObject({
      key: "instagram · feed",
      platform: "instagram",
      position: "feed",
      reach: 800,
    });
  });

  it("los leads por segmento salen de las acciones, con la regla del sync", async () => {
    const result = await fetchBreakdown({
      token: "t",
      adAccountId: "act_1",
      breakdown: "age,gender",
      since: "a",
      until: "b",
      fetchImpl: respond({
        data: [
          {
            age: "25-34",
            gender: "female",
            actions: [
              { action_type: "lead", value: "3" },
              { action_type: "onsite_conversion.lead_grouped", value: "2" },
              { action_type: "link_click", value: "40" },
            ],
          },
          { age: "35-44", gender: "male" },
        ],
      }),
    });

    expect(result.ok && result.data[0]).toMatchObject({ age: "25-34", gender: "female", leads: 5 });
    expect(result.ok && result.data[0].actions.link_click).toBe(40);
    // Sin acciones no hay leads que contar: null, no cero.
    expect(result.ok && result.data[1].leads).toBeNull();
  });

  it("el dispositivo sale de device_platform", async () => {
    const result = await fetchBreakdown({
      token: "t",
      adAccountId: "act_1",
      breakdown: "device_platform",
      since: "a",
      until: "b",
      fetchImpl: respond({ data: [{ device_platform: "mobile_app", spend: "5" }] }),
    });

    expect(result.ok && result.data[0]).toMatchObject({ key: "mobile_app", device: "mobile_app" });
  });

  it("la hora se lee del texto que manda Meta", () => {
    expect(parseHour("14:00:00 - 14:59:59")).toBe(14);
    expect(parseHour("00:00:00 - 00:59:59")).toBe(0);
    expect(parseHour("cualquier cosa")).toBeNull();
    expect(parseHour(undefined)).toBeNull();
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

describe("el alcance unico por objeto", () => {
  it("se pide con level y vuelve como mapa id → alcance", async () => {
    const fetchImpl = respond({
      data: [
        { campaign_id: "c1", reach: "1200" },
        { campaign_id: "c2", reach: "300" },
        { campaign_id: "c3" },
      ],
    });
    const result = await fetchReachByLevel({
      token: "t",
      adAccountId: "act_1",
      level: "campaign",
      since: "2026-10-01",
      until: "2026-10-07",
      fetchImpl,
    });

    expect(result.ok && result.data).toEqual({ c1: 1200, c2: 300 });
    const url = new URL((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(url.searchParams.get("time_increment")).toBeNull();
  });
});
