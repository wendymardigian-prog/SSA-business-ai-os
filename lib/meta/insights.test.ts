/**
 * Lectura de insights de Meta Ads (F55). API simulada.
 */

import { describe, it, expect, vi } from "vitest";
import {
  actionsMap,
  countLeads,
  countPurchases,
  fetchInsights,
  normalizeInsight,
  objectOf,
  readUsage,
  syncRange,
} from "./insights";

function pages(...bodies: unknown[]) {
  const queue = [...bodies];
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => queue.shift() ?? { data: [] },
  })) as unknown as typeof fetch;
}

describe("contar leads (F55)", () => {
  it("los encuentra se llamen como se llamen", () => {
    // Meta los nombra distinto segun el objetivo y la plataforma.
    expect(
      countLeads([
        { action_type: "lead", value: "3" },
        { action_type: "onsite_conversion.lead_grouped", value: "2" },
        { action_type: "link_click", value: "50" },
      ]),
    ).toBe(5);
  });

  it("tambien cuenta los registros completos", () => {
    expect(countLeads([{ action_type: "complete_registration", value: "4" }])).toBe(4);
  });

  it("sin ninguna accion de lead, null y no cero", () => {
    // Un cero diria que la campaña no trajo ninguno; null dice que Meta no
    // informa esa accion para esta campaña.
    expect(countLeads([{ action_type: "link_click", value: "50" }])).toBeNull();
    expect(countLeads(undefined)).toBeNull();
  });

  it("las compras se cuentan igual", () => {
    expect(countPurchases([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "7" }])).toBe(7);
  });
});

describe("las acciones crudas (F55)", () => {
  it("se guardan tal como vinieron", () => {
    // Sus nombres cambian por objetivo: interpretarlas al escribir
    // congelaria la interpretacion de hoy en datos irreversibles.
    expect(
      actionsMap([
        { action_type: "link_click", value: "50" },
        { action_type: "lead", value: "3" },
      ]),
    ).toEqual({ link_click: 50, lead: 3 });
  });

  it("suma las repetidas", () => {
    expect(actionsMap([{ action_type: "lead", value: "2" }, { action_type: "lead", value: "3" }])).toEqual({
      lead: 5,
    });
  });
});

describe("que objeto es cada fila (F55)", () => {
  const raw = {
    campaign_id: "c1",
    campaign_name: "Campaña",
    adset_id: "as1",
    adset_name: "Conjunto",
    ad_id: "a1",
    ad_name: "Anuncio",
  };

  it("a nivel campaña, la campaña", () => {
    expect(objectOf(raw, "campaign", "act_1")).toMatchObject({ objectId: "c1", objectName: "Campaña" });
  });

  it("a nivel anuncio, el anuncio, con su conjunto como padre", () => {
    expect(objectOf(raw, "ad", "act_1")).toMatchObject({ objectId: "a1", parentName: "Conjunto" });
  });

  it("a nivel cuenta, la cuenta", () => {
    expect(objectOf(raw, "account", "act_1").objectId).toBe("act_1");
  });
});

describe("normalizar una fila (F55)", () => {
  const raw = {
    date_start: "2026-10-01",
    campaign_id: "c1",
    campaign_name: "Campaña",
    spend: "125.50",
    impressions: "10000",
    reach: "8000",
    clicks: "350",
    ctr: "3.5",
    actions: [{ action_type: "lead", value: "12" }, { action_type: "link_click", value: "300" }],
  };

  it("convierte los textos de Meta a numeros", () => {
    const row = normalizeInsight(raw, "campaign", "act_1");

    expect(row).toMatchObject({
      spend: 125.5,
      impressions: 10000,
      reach: 8000,
      clicks: 350,
      leads: 12,
      linkClicks: 300,
    });
  });

  it("el ThruPlay es el ThruPlay, no las reproducciones iniciadas", () => {
    const row = normalizeInsight(
      {
        ...raw,
        video_play_actions: [{ action_type: "video_view", value: "900" }],
        video_thruplay_watched_actions: [{ action_type: "video_view", value: "240" }],
        video_avg_time_watched_actions: [{ action_type: "video_view", value: "7.4" }],
      },
      "campaign",
      "act_1",
    );

    expect(row?.thruplays).toBe(240);
    expect(row?.videoAvgTimeSeconds).toBe(7.4);
  });

  it("sin video, el tiempo promedio queda en null y no en cero", () => {
    expect(normalizeInsight(raw, "campaign", "act_1")?.videoAvgTimeSeconds).toBeNull();
  });

  it("una fila sin fecha se descarta: no hay donde guardarla", () => {
    expect(normalizeInsight({ campaign_id: "c1" }, "campaign", "act_1")).toBeNull();
  });

  it("una fila sin objeto tampoco", () => {
    expect(normalizeInsight({ date_start: "2026-10-01" }, "campaign", "act_1")).toBeNull();
  });
});

describe("traer los insights (F55)", () => {
  const params = {
    token: "t",
    adAccountId: "act_1",
    level: "campaign" as const,
    since: "2026-09-29",
    until: "2026-10-01",
  };

  it("sigue las tres paginas y guarda todas las filas", async () => {
    // Cortar en la primera da un dashboard con la mitad del gasto.
    const fetchImpl = pages(
      { data: [{ date_start: "2026-09-29", campaign_id: "c1" }], paging: { next: "https://graph/2" } },
      { data: [{ date_start: "2026-09-30", campaign_id: "c1" }], paging: { next: "https://graph/3" } },
      { data: [{ date_start: "2026-10-01", campaign_id: "c1" }] },
    );

    const result = await fetchInsights({ ...params, fetchImpl });

    expect(result).toMatchObject({ ok: true, pages: 3 });
    expect(result.ok && result.rows).toHaveLength(3);
  });

  it("pide los datos partidos por dia", async () => {
    const fetchImpl = pages({ data: [] });

    await fetchInsights({ ...params, fetchImpl });

    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("time_increment=1");
    expect(url).toContain("level=campaign");
  });

  it("el limite de uso de Meta es reintentable", async () => {
    // La peticion era valida: en una hora anda.
    const fetchImpl = pages({ error: { code: 17, message: "User request limit reached" } });

    const result = await fetchInsights({ ...params, fetchImpl });

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("el 80004 tambien", async () => {
    const fetchImpl = pages({ error: { code: 80004, message: "too many calls" } });

    expect((await fetchInsights({ ...params, fetchImpl })).ok).toBe(false);
    expect(
      ((await fetchInsights({ ...params, fetchImpl: pages({ error: { code: 80004 } }) })) as { retryable: boolean })
        .retryable,
    ).toBe(true);
  });

  it("un token invalido NO es reintentable", async () => {
    const fetchImpl = pages({ error: { code: 190, message: "Invalid token" } });

    expect(await fetchInsights({ ...params, fetchImpl })).toMatchObject({
      ok: false,
      retryable: false,
    });
  });
});

describe("el rango de cada corrida (F55)", () => {
  const now = new Date("2026-10-01T06:00:00Z");

  it("la corrida diaria relee los ultimos 3 dias", () => {
    // Meta corrige los datos recientes durante 48 a 72 horas.
    expect(syncRange({ now, firstSync: false })).toEqual({
      since: "2026-09-29",
      until: "2026-10-01",
    });
  });

  it("al activar una cuenta se traen 90 dias", () => {
    expect(syncRange({ now, firstSync: true }).since).toBe("2026-07-04");
  });
});

describe("la cuota de Meta (F55)", () => {
  it("se lee de la cabecera", () => {
    const usage = readUsage('{"act_1":[{"call_count":45,"total_cputime":20,"total_time":30}]}');

    expect(usage).toEqual({ percent: 45, shouldPause: false });
  });

  it("pasado el 90% conviene parar", () => {
    // El bloqueo de Meta dura una hora y se lleva la corrida entera.
    expect(readUsage('{"act_1":[{"call_count":95}]}')?.shouldPause).toBe(true);
  });

  it("una cabecera que no se entiende no frena nada", () => {
    expect(readUsage("no soy json")).toBeNull();
    expect(readUsage(null)).toBeNull();
  });
});
