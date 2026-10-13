/**
 * Caracterizacion de la atribucion y de los desgloses de Ads ANTES del Extra L.
 *
 * Fija la salida actual de cuatro piezas que el cambio toca por los costados:
 * `formTouch`, `readAttribution`, `pickUtm` y `groupByObject`. Cuando un bloque
 * cambia a proposito una de estas salidas (F16 suma claves a `pickUtm`, F18
 * saca el `utm_content` inventado de `formTouch`, F31 agrega columnas), el
 * cambio se hace con el caso viejo a la vista y se explica en el commit.
 */
import { describe, expect, it } from "vitest";
import { formTouch } from "@/lib/contacts/touch-entry";
import { readAttribution } from "@/lib/contacts/attribution";
import { pickUtm } from "@/lib/scheduling/antispam";
import { groupByObject, type AdsRow } from "@/lib/dashboards/ads";

describe("formTouch (antes de F18)", () => {
  const base = { submissionId: "s-1", formId: "f-1", formName: "Diagnostico gratis" };

  it("con UTMs: medio form, fuente normalizada, ids de anuncio y extras en raw", () => {
    const touch = formTouch({
      ...base,
      attribution: { utm_source: "FB", utm_campaign: "oct", utm_content: "video-1", ad_id: "123", fbclid: "abc", utm_id: "9", fbp: "fb.1.1" },
    });
    expect(touch).toMatchObject({
      medium: "form",
      campaign: "oct",
      content: "video-1",
      adId: "123",
      fbclid: "abc",
      origin: "form",
      dedupeKey: "form:s-1",
    });
    expect(touch.raw).toMatchObject({ source_type: "form", source_id: "f-1", utm_id: "9", fbp: "fb.1.1" });
  });

  it("sin atribucion: fuente web y el contenido es el nombre del formulario (lo que F18 cambia)", () => {
    const touch = formTouch({ ...base, attribution: {} });
    expect(touch.source).toBe("web");
    expect(touch.content).toBe("Diagnostico gratis");
    expect(touch.occurredAt).toBeUndefined();
  });
});

describe("readAttribution (forma canonica y claves ajenas)", () => {
  it("lee primer y ultimo toque e ignora las claves que no conoce", () => {
    const attribution = readAttribution({
      version: 2,
      first_touch: { source: "instagram", medium: "dm", origin: "dm", occurred_at: "2026-10-01T10:00:00Z", meta_ad_id: "999" },
      last_touch: { source: "facebook", medium: "paid_social", origin: "form", occurred_at: "2026-10-05T10:00:00Z", ad_id: "123", campaign_id: "77" },
    });
    expect(attribution.first_touch).toMatchObject({ source: "instagram", medium: "dm", origin: "dm" });
    expect(attribution.last_touch).toMatchObject({ source: "facebook", ad_id: "123", campaign_id: "77" });
    // Una clave que el lector no conoce no se cuela: F27 suma `meta_*` al JSON de la base
    // sin que esto rompa a los lectores existentes (se ven recien cuando F21 las lee).
    expect(attribution.first_touch as Record<string, unknown>).not.toHaveProperty("meta_ad_id");
  });

  it("un valor vacio o invalido no lanza", () => {
    expect(() => readAttribution(null)).not.toThrow();
    expect(() => readAttribution("x")).not.toThrow();
    expect(() => readAttribution({})).not.toThrow();
  });
});

describe("pickUtm (lista de la agenda antes de F16)", () => {
  it("copia las cinco UTMs y los cuatro ids de clic, recortados a 200", () => {
    const picked = pickUtm({
      utm_source: "fb",
      utm_medium: "cpc",
      utm_campaign: "x".repeat(300),
      fbclid: "f",
      gclid: "g",
      ttclid: "t",
      li_fat_id: "l",
      ad_id: "123",
      utm_id: "9",
    });
    expect(Object.keys(picked).sort()).toEqual(["fbclid", "gclid", "li_fat_id", "ttclid", "utm_campaign", "utm_medium", "utm_source"]);
    expect(picked.utm_campaign).toHaveLength(200);
  });

  it("acepta URLSearchParams y descarta los vacios", () => {
    expect(pickUtm(new URLSearchParams("utm_source=ig&utm_term="))).toEqual({ utm_source: "ig" });
  });
});

describe("groupByObject (solo metricas de Meta, antes de F31)", () => {
  const row = (over: Partial<AdsRow>): AdsRow => ({
    level: "ad", objectId: "a1", objectName: "Anuncio", parentName: "Conjunto", campaignId: "c1", adsetId: "s1", date: "2026-10-01",
    spend: 10, impressions: 100, reach: 80, clicks: 5, outboundClicks: 4, linkClicks: 4, leads: 1, purchases: 0, purchaseValue: 0,
    status: "ACTIVE", effectiveStatus: null, qualityRanking: null, engagementRanking: null, conversionRanking: null,
    videoP25: null, videoP50: null, videoP75: null, videoP95: null, videoP100: null, thruplays: null, videoAvgTimeSeconds: null,
    actions: {}, updatedAt: null, ...over,
  });

  it("suma por objeto, toma nombre y estado de la fila mas nueva y ordena por gasto", () => {
    const grouped = groupByObject(
      [
        row({ objectId: "a1", date: "2026-10-01", spend: 10, objectName: "Viejo" }),
        row({ objectId: "a1", date: "2026-10-02", spend: 5, objectName: "Nuevo", effectiveStatus: "PAUSED" }),
        row({ objectId: "a2", spend: 100, objectName: "Caro" }),
        row({ level: "campaign", objectId: "c1", spend: 999 }),
      ],
      "ad",
    );
    expect(grouped.map((g) => g.objectId)).toEqual(["a2", "a1"]);
    expect(grouped[1]).toMatchObject({ objectName: "Nuevo", status: "PAUSED", spend: 15 });
  });

  it("los cocientes salen de los totales y una division por cero es null", () => {
    const [g] = groupByObject([row({ clicks: 0, leads: 0, spend: 10 })], "ad");
    expect(g.cpc).toBeNull();
    expect(g.cpl).toBeNull();
  });
});
