/**
 * F23: el catalogo de Meta, con respuestas del grafo simuladas (nada sale a internet).
 */
import { describe, expect, it, vi } from "vitest";
import { EFFECTIVE_STATUSES, fetchEntities, MAX_ENTITY_PAGES, normalizeAd, normalizeAdset, normalizeCampaign, updatedSinceFor } from "./entities";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: true, status: 200, json: async () => body, headers: new Headers(headers) }) as unknown as Response;

const campaigns = (ids: string[], next?: string) => ({
  data: ids.map((id) => ({ id, name: `Camp ${id}`, status: "PAUSED", effective_status: "PAUSED", daily_budget: "5000" })),
  ...(next ? { paging: { next } } : {}),
});

describe("normalizadores", () => {
  it("la campaña: nombre, clave, presupuestos a numero y estados", () => {
    expect(normalizeCampaign({ id: "1", name: " Video  Ána ", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "5000", lifetime_budget: "" })).toMatchObject({
      campaignId: "1",
      nameKey: "video ana",
      effectiveStatus: "ACTIVE",
      dailyBudget: 5000,
      lifetimeBudget: null,
    });
  });

  it("sin id no hay fila", () => {
    expect(normalizeCampaign({ name: "x" })).toBeNull();
    expect(normalizeAdset({})).toBeNull();
    expect(normalizeAd({})).toBeNull();
  });

  it("el conjunto lee `end_time` como fin", () => {
    expect(normalizeAdset({ id: "2", campaign_id: "1", end_time: "2026-10-30T00:00:00+0000" })).toMatchObject({ adsetId: "2", campaignId: "1", stopTime: "2026-10-30T00:00:00+0000" });
  });

  it("el anuncio: creativo, miniatura (con respaldo a image_url) y la publicacion que promociona", () => {
    const ad = normalizeAd({
      id: "9",
      name: "Anuncio 9",
      adset_id: "2",
      campaign_id: "1",
      effective_status: "ARCHIVED",
      creative: { id: "c1", title: "Titulo", body: "Texto", call_to_action_type: "LEARN_MORE", image_url: "https://x/y.jpg", effective_instagram_media_id: "ig-1", effective_object_story_id: "p_1" },
    });
    expect(ad).toMatchObject({
      adId: "9",
      effectiveStatus: "ARCHIVED",
      creativeId: "c1",
      creative: { title: "Titulo", body: "Texto", cta: "LEARN_MORE" },
      thumbnailSourceUrl: "https://x/y.jpg",
      instagramMediaId: "ig-1",
      objectStoryId: "p_1",
    });
  });
});

describe("fetchEntities", () => {
  it("pide TODOS los estados (pausados y archivados incluidos) y trae las filas", async () => {
    const fetchImpl = vi.fn(async (_url: unknown) => json(campaigns(["1", "2"])));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", fetchImpl });

    expect(result.ok && result.rows.map((r) => r.campaignId)).toEqual(["1", "2"]);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toContain("/act_1/campaigns");
    const filter = JSON.parse(url.searchParams.get("filtering")!);
    expect(filter[0].value).toEqual([...EFFECTIVE_STATUSES]);
    for (const status of ["ACTIVE", "PAUSED", "ARCHIVED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "DELETED"]) {
      expect(filter[0].value).toContain(status);
    }
    expect(url.searchParams.get("updated_since")).toBeNull();
  });

  it("sigue paging.next cuando hay dos paginas", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(campaigns(["1"], "https://graph.facebook.com/page2")))
      .mockResolvedValueOnce(json(campaigns(["2"])));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", fetchImpl });
    expect(result.ok && result.rows.map((r) => r.campaignId)).toEqual(["1", "2"]);
    expect(result.ok && result.pages).toBe(2);
    expect(result.ok && result.stopReason).toBeNull();
  });

  it("en un sync incremental manda updated_since (en segundos)", async () => {
    const fetchImpl = vi.fn(async (_url: unknown) => json(campaigns([])));
    await fetchEntities({ token: "t", adAccountId: "act_1", level: "ad", updatedSince: new Date("2026-10-01T00:00:00Z"), fetchImpl });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("updated_since")).toBe(String(Date.parse("2026-10-01T00:00:00Z") / 1000));
  });

  it("al llegar al tope de paginas corta y lo DICE", async () => {
    const fetchImpl = vi.fn(async () => json(campaigns(["1"], "https://graph.facebook.com/otra")));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", maxPages: 3, fetchImpl });
    expect(result.ok && result.stopReason).toBe("capped");
    expect(result.ok && result.pages).toBe(3);
    expect(MAX_ENTITY_PAGES).toBe(50);
  });

  it("si el uso pasa el 90 % corta (y lo dice) en vez de insistir", async () => {
    const header = JSON.stringify({ "123": [{ call_count: 95, total_cputime: 10, total_time: 10 }] });
    const fetchImpl = vi.fn(async () => json(campaigns(["1"], "https://graph.facebook.com/otra"), { "x-business-use-case-usage": header }));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", fetchImpl });
    expect(result.ok && result.stopReason).toBe("usage");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("con un uso bajo no corta", async () => {
    const header = JSON.stringify({ "123": [{ call_count: 20, total_cputime: 10, total_time: 10 }] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(campaigns(["1"], "https://graph.facebook.com/p2"), { "x-business-use-case-usage": header }))
      .mockResolvedValueOnce(json(campaigns(["2"]), { "x-business-use-case-usage": header }));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", fetchImpl });
    expect(result.ok && result.rows).toHaveLength(2);
  });

  it("si Meta rechaza DELETED, reintenta sin el y lo avisa", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 100, message: "Invalid parameter" } }))
      .mockResolvedValueOnce(json(campaigns(["1"])));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "campaign", fetchImpl });
    expect(result.ok && result.deletedRejected).toBe(true);
    const retried = JSON.parse(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get("filtering")!);
    expect(retried[0].value).not.toContain("DELETED");
    expect(retried[0].value).toContain("ARCHIVED");
  });

  it("un limite de uso del grafo vuelve como error reintentable, sin lanzar", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 17, message: "limit" } }));
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "ad", fetchImpl });
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("una caida de red vuelve como error reintentable, sin lanzar", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await fetchEntities({ token: "t", adAccountId: "act_1", level: "ad", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, retryable: true, error: "ECONNRESET" });
  });
});

describe("updatedSinceFor", () => {
  it("la primera vez (sin fecha) lee todo", () => {
    expect(updatedSinceFor(null)).toBeNull();
    expect(updatedSinceFor(undefined)).toBeNull();
    expect(updatedSinceFor("no es una fecha")).toBeNull();
  });
  it("despues, la ultima vez completa menos un dia", () => {
    expect(updatedSinceFor("2026-10-10T12:00:00Z")?.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});
