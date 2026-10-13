import { describe, expect, it } from "vitest";
import { buildWebhookTouch, canonicalWebhookKey, cleanAttributionValue, detectAttribution, effectiveAttribution } from "./attribution";

describe("detectAttribution", () => {
  it("encuentra las UTMs en un contenedor `hidden` sin mapeo", () => {
    expect(detectAttribution({ email: "a@b.com", hidden: { utm_source: "facebook", utm_content: "120215" } }, {})).toEqual({ utm_source: "facebook", utm_content: "120215" });
  });

  it("orden: la URL gana a la raíz y la raíz a los contenedores", () => {
    const found = detectAttribution({ utm_source: "raiz", hidden: { utm_source: "oculto", utm_term: "t" } }, { utm_source: "url" });
    expect(found).toEqual({ utm_source: "url", utm_term: "t" });
  });

  it("no distingue mayúsculas y entiende los alias", () => {
    expect(detectAttribution({ UTM_Campaign: "oct", scclid: "abc" }, {})).toEqual({ utm_campaign: "oct", sccid: "abc" });
  });

  it("encuentra landing_page y referrer_url", () => {
    expect(detectAttribution({ tracking: { landing_page: "https://x.com/a", referrer_url: "https://g.com" } }, {})).toEqual({ landing_page: "https://x.com/a", referrer_url: "https://g.com" });
  });

  it("no busca más de un nivel adentro ni en contenedores desconocidos", () => {
    expect(detectAttribution({ hidden: { deep: { utm_source: "x" } }, otro: { utm_source: "y" } }, {})).toEqual({});
  });

  it("un payload raro no lanza", () => {
    for (const p of [null, undefined, [1], "x", 3]) expect(() => detectAttribution(p, null)).not.toThrow();
  });
});

describe("cleanAttributionValue", () => {
  it("descarta vacíos, nulos y valores sin reemplazar", () => {
    for (const bad of [undefined, null, "", "  ", "{{campaign.id}}", "{campaign.id}", "undefined", "null", {}]) {
      expect(cleanAttributionValue("utm_campaign", bad)).toBeNull();
    }
  });
  it("recorta a 200 caracteres", () => {
    expect(cleanAttributionValue("utm_content", "x".repeat(300))).toHaveLength(200);
  });
  it("un utm_source que es solo dígitos de más de 8 es un id pegado por error", () => {
    expect(cleanAttributionValue("utm_source", "1202345678901")).toBeNull();
    expect(cleanAttributionValue("utm_source", "12345678")).toBe("12345678");
    expect(cleanAttributionValue("utm_content", "1202345678901")).toBe("1202345678901");
  });
  it("un número se acepta como texto", () => {
    expect(cleanAttributionValue("ad_id", 123)).toBe("123");
  });
});

describe("effectiveAttribution", () => {
  it("lo mapeado a mano gana a lo que se detecta", () => {
    const eff = effectiveAttribution({ payload: { utm_source: "raiz", utm_term: "t" }, query: {}, mapped: { utm_source: "manual" }, autoDetect: true });
    expect(eff).toEqual({ utm_source: "manual", utm_term: "t" });
  });
  it("sin autoDetect solo vale lo mapeado", () => {
    expect(effectiveAttribution({ payload: { utm_source: "raiz" }, query: {}, mapped: { utm_campaign: "c" }, autoDetect: false })).toEqual({ utm_campaign: "c" });
  });
  it("utm_campaign = {{campaign.id}} no se guarda", () => {
    expect(effectiveAttribution({ payload: { utm_campaign: "{{campaign.id}}" }, query: {}, mapped: {}, autoDetect: true })).toEqual({});
  });
});

describe("buildWebhookTouch", () => {
  const base = { inboundId: "in-1", nodeId: "n-1", endpointId: "ep-1", endpointName: "Typeform" };

  it("origen webhook, medio form y el dedupe por envío y paso", () => {
    const t = buildWebhookTouch({ ...base, attribution: { utm_source: "Facebook", utm_content: "120215", ad_id: "9", fbp: "fb.1.2" }, touchMedium: "external_form" });
    expect(t).toMatchObject({ source: "facebook", medium: "form", content: "120215", adId: "9", origin: "webhook", dedupeKey: "webhook:in-1:n-1" });
    expect(t.raw).toMatchObject({ endpoint_id: "ep-1", endpoint_name: "Typeform", source_type: "webhook", fbp: "fb.1.2" });
  });

  it("sin nada de atribución igual hay un toque webhook con medio form", () => {
    expect(buildWebhookTouch({ ...base, attribution: {}, touchMedium: "external_form" })).toMatchObject({ source: "webhook", medium: "form", origin: "webhook" });
  });

  it("con medio 'otro' usa la UTM o referral", () => {
    expect(buildWebhookTouch({ ...base, attribution: { utm_medium: "email" }, touchMedium: "other" }).medium).toBe("email");
    expect(buildWebhookTouch({ ...base, attribution: {}, touchMedium: "other" }).medium).toBe("referral");
  });

  it("canonicalWebhookKey", () => {
    expect(canonicalWebhookKey(" UTM_SOURCE ")).toBe("utm_source");
    expect(canonicalWebhookKey("nombre")).toBeNull();
  });
});
