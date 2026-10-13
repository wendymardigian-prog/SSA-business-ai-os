import { describe, expect, it } from "vitest";
import { ambiguousKeys, buildUnlinkedRows, parseDays, parsePage, parseView, sinceFor, type UnlinkedTouch } from "./unlinked-view";

const touch = (over: Partial<UnlinkedTouch> = {}): UnlinkedTouch => ({
  id: "t-1", contact_id: "c-1", occurred_at: "2026-09-12T15:00:00Z", source: "facebook", medium: "paid_social", origin: "booking",
  campaign: null, content_label: null, term: null, ad_id: null, adset_id: null, campaign_id: null, fbclid: null,
  meta_match_status: "unmatched", meta_match_method: null, meta_match_reason: "id_not_in_catalog",
  meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null, ...over,
});

describe("parametros", () => {
  it("dias: solo los de la lista, 90 por defecto", () => {
    expect(parseDays("30")).toBe(30);
    expect(parseDays("365")).toBe(365);
    expect(parseDays("7")).toBe(90);
    expect(parseDays(undefined)).toBe(90);
    expect(parseDays(["180"])).toBe(180);
  });
  it("vista y pagina", () => {
    expect(parseView("manuales")).toBe("manuales");
    expect(parseView("x")).toBe("sin-vincular");
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("abc")).toBe(1);
  });
  it("sinceFor resta los dias", () => {
    expect(sinceFor(90, new Date("2026-10-13T00:00:00Z"))).toBe("2026-07-15T00:00:00.000Z");
  });
});

describe("buildUnlinkedRows", () => {
  it("un toque con ad_id: muestra el valor y el motivo en palabras", () => {
    const [row] = buildUnlinkedRows({ touches: [touch({ ad_id: "1202345" })], contactNames: { "c-1": "Ana Pérez" } });
    expect(row).toMatchObject({ contactName: "Ana Pérez", when: "12 sep", origin: "Facebook · Reserva", status: "unmatched" });
    expect(row.values).toEqual([{ label: "ad_id", value: "1202345" }]);
    expect(row.reasons[0]).toContain("El anuncio 1202345 no está en la cuenta");
  });

  it("fbclid se muestra como «sí» (nunca el valor) y dice que no alcanza", () => {
    const [row] = buildUnlinkedRows({ touches: [touch({ fbclid: "IwAR0secreto", meta_match_reason: "fbclid_only" })], contactNames: {} });
    expect(row.values).toEqual([{ label: "fbclid", value: "sí" }]);
    expect(JSON.stringify(row)).not.toContain("IwAR0secreto");
    expect(row.reasons[0]).toContain("no alcanza para saber el anuncio");
    expect(row.contactName).toBe("Sin nombre");
  });

  it("un nombre ambiguo cuenta los anuncios con ese nombre", () => {
    const counts = { ads: { "video testimonio": 3 }, campaigns: {} };
    const [row] = buildUnlinkedRows({ touches: [touch({ content_label: "Video%20Testimonio", meta_match_reason: "ambiguous_ad_name" })], contactNames: {}, counts });
    expect(row.reasons[0]).toContain("Hay 3 anuncios con el nombre «Video Testimonio»");
    expect(row.values).toContainEqual({ label: "utm_content", value: "Video%20Testimonio" });
  });

  it("un comentario organico no muestra su titulo como si fuera un UTM", () => {
    const [row] = buildUnlinkedRows({ touches: [touch({ origin: "comment", content_label: "Titulo de la publicacion", ad_id: "55" })], contactNames: {} });
    // Trae un ad_id: es de un anuncio, asi que el titulo si cuenta.
    expect(row.values.map((v) => v.label)).toContain("utm_content");
    const [organic] = buildUnlinkedRows({ touches: [touch({ origin: "comment", content_label: "Titulo de la publicacion", fbclid: "x" })], contactNames: {} });
    expect(organic.values.map((v) => v.label)).not.toContain("utm_content");
  });

  it("un vinculo manual dice que fue a mano y trae lo elegido; un ignorado, nada", () => {
    const [manual, ignored] = buildUnlinkedRows({
      touches: [
        touch({ id: "m", meta_match_status: "manual", meta_match_reason: null, meta_ad_id: "3002", meta_adset_id: "2002", meta_campaign_id: "1002" }),
        touch({ id: "i", meta_match_status: "ignored", meta_match_reason: null }),
      ],
      contactNames: {},
    });
    expect(manual).toMatchObject({ status: "manual", method: "a mano", chosen: { adId: "3002", adsetId: "2002", campaignId: "1002" }, reasons: [] });
    expect(ignored).toMatchObject({ status: "ignored", chosen: null, reasons: [] });
  });
});

describe("ambiguousKeys", () => {
  it("junta solo las claves de los toques con un motivo de nombre ambiguo", () => {
    const keys = ambiguousKeys([
      touch({ content_label: "Video Testimonio", meta_match_reason: "ambiguous_ad_name" }),
      touch({ campaign: "Retargeting", meta_match_reason: "ambiguous_campaign_name" }),
      touch({ content_label: "Otro", meta_match_reason: "name_not_found" }),
    ]);
    expect(keys).toEqual({ ads: ["video testimonio"], campaigns: ["retargeting"] });
  });
});
