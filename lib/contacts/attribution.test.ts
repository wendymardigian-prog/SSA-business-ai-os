import { describe, it, expect } from "vitest";
import {
  mergeAttribution,
  parseTrackingParams,
  readAttribution,
  readClickAttribution,
  isAttributionEmpty,
} from "./attribution";

describe("parseTrackingParams", () => {
  it("saca los parametros conocidos y descarta el resto", () => {
    const params = new URLSearchParams({
      utm_source: "facebook",
      utm_medium: "cpc",
      fbclid: "abc123",
      ref: "ignorar",
    });

    const click = parseTrackingParams(params, "2026-01-15T10:30:00.000Z");

    expect(click).toEqual({
      utm_source: "facebook",
      utm_medium: "cpc",
      fbclid: "abc123",
      captured_at: "2026-01-15T10:30:00.000Z",
    });
  });

  it("devuelve null cuando no vino ningun parametro de tracking", () => {
    expect(parseTrackingParams(new URLSearchParams({ page: "2" }))).toBeNull();
    expect(parseTrackingParams({})).toBeNull();
    expect(parseTrackingParams(null)).toBeNull();
  });

  it("ignora los vacios y los que no son texto", () => {
    expect(parseTrackingParams({ utm_source: "   ", gclid: 42 })).toBeNull();
  });
});

describe("mergeAttribution", () => {
  const primero = { utm_source: "facebook", captured_at: "2026-01-15T10:30:00.000Z" };
  const segundo = { utm_source: "google", captured_at: "2026-02-20T14:00:00.000Z" };

  it("sobre un contacto sin atribucion, la primera interaccion es first y last", () => {
    const result = mergeAttribution({}, primero);
    expect(result.first_click).toEqual(primero);
    expect(result.last_click).toEqual(primero);
  });

  it("no pisa el first_click nunca", () => {
    const result = mergeAttribution({ first_click: primero, last_click: primero }, segundo);
    expect(result.first_click).toEqual(primero);
    expect(result.last_click).toEqual(segundo);
  });

  it("aunque pasen muchas interacciones, el first sigue siendo el original", () => {
    let attribution = mergeAttribution({}, primero);
    attribution = mergeAttribution(attribution, segundo);
    attribution = mergeAttribution(attribution, {
      utm_source: "tiktok",
      captured_at: "2026-03-01T00:00:00.000Z",
    });

    expect(attribution.first_click?.utm_source).toBe("facebook");
    expect(attribution.last_click?.utm_source).toBe("tiktok");
  });

  it("una interaccion sin parametros no toca nada", () => {
    const previa = { first_click: primero, last_click: primero };
    expect(mergeAttribution(previa, null)).toEqual(previa);
    expect(mergeAttribution(previa, {})).toEqual(previa);
  });

  it("copia el click en vez de referenciarlo, para que mutarlo despues no ensucie la fila", () => {
    const click = { utm_source: "facebook" };
    const result = mergeAttribution({}, click);
    click.utm_source = "otro";
    expect(result.first_click?.utm_source).toBe("facebook");
  });
});

describe("readClickAttribution (la forma de clicks)", () => {
  it("tolera un jsonb con cualquier forma sin romper", () => {
    expect(readClickAttribution(null)).toEqual({});
    expect(readClickAttribution("texto suelto")).toEqual({});
    expect(readClickAttribution([1, 2, 3])).toEqual({});
    expect(readClickAttribution({ first_click: "no es objeto" })).toEqual({});
  });

  it("se queda solo con las claves conocidas", () => {
    const result = readClickAttribution({
      first_click: { utm_source: "facebook", basura: "x", captured_at: "2026-01-01T00:00:00.000Z" },
    });
    expect(result.first_click).toEqual({
      utm_source: "facebook",
      captured_at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("isAttributionEmpty", () => {
  it("distingue el contacto sin atribucion del que tiene", () => {
    expect(isAttributionEmpty({})).toBe(true);
    expect(isAttributionEmpty(readAttribution({ last_click: { gclid: "x" } }))).toBe(false);
  });
});


// ── F84: la lectura canonica de las tres formas ──────────────────────────────
//
// Hay tres formas guardadas en `contacts.attribution`. Que `readAttribution`
// las entienda a las tres es lo que hace visible, por ejemplo, la atribucion de
// una reserva, que antes se leia como vacia.

describe("readAttribution: la forma canonica (F84)", () => {
  it("lee first_touch y last_touch tal como los deja record_contact_touch", () => {
    const result = readAttribution({
      version: 2,
      first_touch: { occurred_at: "2026-09-12T10:00:00Z", source: "instagram", medium: "comment", content: "reel de dolares", content_post_id: "cp-1", origin: "comment" },
      last_touch: { source: "instagram", medium: "dm", origin: "dm" },
    });

    expect(result.first_touch).toEqual({
      occurred_at: "2026-09-12T10:00:00Z", source: "instagram", medium: "comment",
      content: "reel de dolares", content_post_id: "cp-1", origin: "comment",
    });
    expect(result.last_touch).toEqual({ source: "instagram", medium: "dm", origin: "dm" });
  });

  it("conserva la marca de medio crudo", () => {
    const result = readAttribution({ first_touch: { source: "web", medium: "podcast", medium_raw: true } });

    expect(result.first_touch?.medium_raw).toBe(true);
  });

  it("se queda solo con las claves conocidas", () => {
    const result = readAttribution({ first_touch: { source: "instagram", basura: "x", token: "secreto" } });

    expect(result.first_touch).toEqual({ source: "instagram" });
  });

  it("un solo toque: el otro no aparece", () => {
    expect(readAttribution({ last_touch: { source: "instagram" } })).toEqual({ last_touch: { source: "instagram" } });
  });
});

describe("readAttribution: la forma vieja de clicks (F84)", () => {
  it("la devuelve como first_touch y last_touch SIN perder ningun campo", () => {
    const result = readAttribution({
      first_click: {
        utm_source: "facebook", utm_medium: "cpc", utm_campaign: "oct", utm_content: "video1", utm_term: "crm",
        fbclid: "fb1", gclid: "g1", ad_id: "ad1", campaign_id: "c1", adset_id: "as1",
        referrer_url: "https://r.com", landing_page: "https://l.com", captured_at: "2026-09-01T00:00:00Z",
      },
      last_click: { utm_source: "instagram", utm_medium: "bio" },
    });

    expect(result.first_touch).toEqual({
      source: "facebook", medium: "paid_social", campaign: "oct", content: "video1", term: "crm",
      fbclid: "fb1", gclid: "g1", ad_id: "ad1", campaign_id: "c1", adset_id: "as1",
      referrer_url: "https://r.com", landing_page: "https://l.com", occurred_at: "2026-09-01T00:00:00Z",
    });
    expect(result.last_touch).toEqual({ source: "instagram", medium: "link_in_bio" });
  });

  it("un utm_medium fuera de la lista se conserva y queda marcado", () => {
    const result = readAttribution({ first_click: { utm_source: "web", utm_medium: "podcast" } });

    expect(result.first_touch).toMatchObject({ medium: "podcast", medium_raw: true });
  });
});

describe("readAttribution: la forma plana del agendamiento (F84)", () => {
  // Esto devolvia {} antes: la atribucion de las reservas era invisible.
  const flat = {
    utm_source: "instagram", utm_campaign: "octubre", utm_content: "reel-1", fbclid: "fb1",
    source: "scheduling", referrer: "https://ssa.com/agenda",
  };

  it("devuelve source scheduling y medium booking", () => {
    const result = readAttribution(flat);

    expect(result.first_touch).toMatchObject({ source: "scheduling", medium: "booking", origin: "booking" });
    expect(result.first_touch).toMatchObject({
      campaign: "octubre", content: "reel-1", fbclid: "fb1", referrer_url: "https://ssa.com/agenda",
    });
  });

  it("first y last son el mismo toque, y no la misma referencia", () => {
    const result = readAttribution(flat);

    expect(result.last_touch).toEqual(result.first_touch);
    expect(result.last_touch).not.toBe(result.first_touch);
  });

  it("un objeto con un `source` suelto que NO es de agendamiento no se confunde con uno", () => {
    expect(readAttribution({ source: "manual", utm_source: "x" })).toEqual({});
  });
});

describe("readAttribution: preferencias y robustez (F84)", () => {
  it("si hay toques, mandan sobre las formas viejas que sigan en el objeto", () => {
    // `record_contact_touch` mezcla con `||` y no borra lo que habia.
    const result = readAttribution({
      version: 2,
      first_touch: { source: "instagram", medium: "dm" },
      last_touch: { source: "instagram", medium: "dm" },
      first_click: { utm_source: "facebook" },
      source: "scheduling",
    });

    expect(result.first_touch).toEqual({ source: "instagram", medium: "dm" });
  });

  it("tolera cualquier cosa sin romper", () => {
    expect(readAttribution(null)).toEqual({});
    expect(readAttribution(undefined)).toEqual({});
    expect(readAttribution("texto")).toEqual({});
    expect(readAttribution([1, 2])).toEqual({});
    expect(readAttribution({})).toEqual({});
    expect(readAttribution({ first_touch: "no es objeto", last_touch: 5 })).toEqual({});
  });

  it("isAttributionEmpty distingue las tres formas llenas del vacio", () => {
    expect(isAttributionEmpty(readAttribution({}))).toBe(true);
    expect(isAttributionEmpty(readAttribution({ first_touch: { source: "instagram" } }))).toBe(false);
    expect(isAttributionEmpty(readAttribution({ first_click: { gclid: "x" } }))).toBe(false);
    expect(isAttributionEmpty(readAttribution({ source: "scheduling" }))).toBe(false);
  });
});
