import { describe, expect, it } from "vitest";
import {
  touchSourceLink,
  ambiguousKeys,
  buildRuleRows,
  buildUnlinkedRows,
  firstAndLastTouch,
  groupUnlinked,
  parseDays,
  parsePage,
  parseView,
  pickerSeed,
  ruleKeyOf,
  sinceFor,
  type ContactFacts,
  type MetaRuleRecord,
  type UnlinkedTouch,
} from "./unlinked-view";

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
    expect(parseView("sin-anuncio")).toBe("sin-anuncio");
    expect(parseView("revisar")).toBe("revisar");
    expect(parseView("reglas")).toBe("reglas");
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
    expect(manual).toMatchObject({ status: "manual", method: "a mano", linked: "Campaña 1002 › Conjunto 2002 › Anuncio 3002", reasons: [] });
    expect(ignored).toMatchObject({ status: "ignored", linked: null, reasons: [] });
  });

  it("con el catalogo dice los nombres, y uno sin anuncio queda para elegirlo", () => {
    const [row] = buildUnlinkedRows({
      touches: [touch({ id: "p", meta_match_status: "matched", meta_match_reason: null, meta_adset_id: "2002", meta_campaign_id: "1002", meta_ad_id: null })],
      contactNames: {},
      names: { campaigns: { "1002": "Noviembre" }, adsets: { "2002": "Caliente" }, ads: {} },
    });
    expect(row).toMatchObject({ status: "matched", linked: "Noviembre › Caliente" });
  });

  it("enlaza la respuesta o la reunion de origen", () => {
    expect(touchSourceLink({ dedupe_key: "booking:abc", raw: null })).toEqual({ href: "/dashboard/agenda?agenda=abc", label: "Ver la reunión" });
    expect(touchSourceLink({ dedupe_key: "form:abc", raw: { source_id: "f1" } })).toEqual({ href: "/dashboard/formularios/f1/respuestas/abc", label: "Ver la respuesta" }); // @plantilla-quitar(formularios)
    expect(touchSourceLink({ dedupe_key: "form:abc", raw: {} })).toBeNull();
    expect(touchSourceLink({ dedupe_key: "msg:1", raw: null })).toBeNull();
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

describe("groupUnlinked (00318)", () => {
  const ad = (over: Partial<UnlinkedTouch>) =>
    touch({ origin: "form", source: "meta", medium: "form", raw: { utm: { utm_medium: "paid" } }, campaign: "promo-5-mayo", content_label: "ad-f1-costo", meta_match_reason: "name_not_found", ...over });
  const none: ContactFacts = { hasBooking: false, hasSale: false, firstTouchId: null, lastTouchId: null };

  it("junta los toques con los mismos UTMs (sin importar mayusculas ni codificacion) y cuenta personas, no toques", () => {
    const touches = [
      ad({ id: "a", contact_id: "c1" }),
      ad({ id: "b", contact_id: "c1", content_label: "AD-F1-COSTO" }),
      ad({ id: "c", contact_id: "c2", campaign: "promo%2D5%2Dmayo" }),
      ad({ id: "d", contact_id: "c3", content_label: "ad-c2-metodo" }),
    ];
    const groups = groupUnlinked({ touches, rows: buildUnlinkedRows({ touches, contactNames: {} }), facts: {} });
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ peopleCount: 2, touchIds: ["a", "b", "c"], rule: { utmCampaign: "promo-5-mayo", utmContent: "ad-f1-costo", utmTerm: null }, search: "f1" });
    expect(groups[1]).toMatchObject({ peopleCount: 1, search: "c2" });
  });

  it("ordena por impacto: ventas, agendas, personas", () => {
    const touches = [ad({ id: "a", contact_id: "c1" }), ad({ id: "b", contact_id: "c2" }), ad({ id: "c", contact_id: "c3", content_label: "ad-c2-metodo" })];
    const facts = { c3: { ...none, hasSale: true } };
    const groups = groupUnlinked({ touches, rows: buildUnlinkedRows({ touches, contactNames: {} }), facts });
    expect(groups[0]).toMatchObject({ withSale: 1, peopleCount: 1 });
    expect(groups[1]).toMatchObject({ withSale: 0, peopleCount: 2 });
  });

  it("dice cuantas personas lo tienen como primer y ultimo toque", () => {
    const touches = [ad({ id: "a", contact_id: "c1" }), ad({ id: "b", contact_id: "c2" })];
    const facts = { c1: { ...none, firstTouchId: "a", lastTouchId: "z", hasBooking: true }, c2: { ...none, firstTouchId: "y", lastTouchId: "b" } };
    const [group] = groupUnlinked({ touches, rows: buildUnlinkedRows({ touches, contactNames: {} }), facts });
    expect(group).toMatchObject({ firstCount: 1, lastCount: 1, withBooking: 1 });
    expect(group.people.find((p) => p.touchId === "a")).toMatchObject({ isFirstTouch: true, isLastTouch: false, hasBooking: true });
  });

  it("un grupo sin UTMs (solo un id que no esta) no tiene regla: se vincula toque por toque", () => {
    const touches = [touch({ id: "a", ad_id: "999" }), touch({ id: "b", ad_id: "999", contact_id: "c2" }), touch({ id: "c", ad_id: "888" })];
    const groups = groupUnlinked({ touches, rows: buildUnlinkedRows({ touches, contactNames: {} }), facts: {} });
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.rule === null)).toBe(true);
  });

  it("lo vinculado por parecido trae a que quedo vinculado, para confirmarlo", () => {
    const touches = [ad({ id: "a", meta_match_status: "matched", meta_match_method: "utm_content_similar_campaign", meta_match_reason: null, meta_ad_id: "3007", meta_adset_id: "2005", meta_campaign_id: "1006" })];
    const [group] = groupUnlinked({ touches, rows: buildUnlinkedRows({ touches, contactNames: {} }), facts: {} });
    expect(group.linkedIds).toEqual({ adId: "3007", adsetId: "2005", campaignId: "1006" });
    expect(group.method).toContain("parecido");
  });
});

describe("pickerSeed", () => {
  it("un codigo con letras y numeros, si no la palabra mas larga", () => {
    expect(pickerSeed("ad-n4-techo")).toBe("n4");
    expect(pickerSeed("clase-9-nov")).toBe("clase");
    expect(pickerSeed("Video%20Testimonio")).toBe("testimonio");
    expect(pickerSeed(null)).toBe("");
  });
});

describe("firstAndLastTouch", () => {
  it("ordena por fecha, despues por alta y por id (como refresh_contact_attribution)", () => {
    const got = firstAndLastTouch([
      { id: "b", contact_id: "c", occurred_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:01Z" },
      { id: "a", contact_id: "c", occurred_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:01Z" },
      { id: "z", contact_id: "c", occurred_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" },
    ]);
    expect(got).toEqual({ c: { firstTouchId: "a", lastTouchId: "z" } });
  });
});

describe("buildRuleRows", () => {
  const rule = (over: Partial<MetaRuleRecord> = {}): MetaRuleRecord => ({
    id: "r1", campaign_key: "promo-5-mayo", content_key: "ad-f1-costo", term_key: "", utm_campaign: "promo-5-mayo", utm_content: "ad-f1-costo", utm_term: null,
    action: "link", ad_id: "3007", adset_id: "2005", campaign_id: "1006", origin: "confirmed", created_at: "2026-11-07T12:00:00Z", ...over,
  });
  it("muestra los UTMs, el destino con nombres y cuantos toques la usan", () => {
    const [row] = buildRuleRows({
      rules: [rule()],
      names: { campaigns: { "1006": "Promo Frío" }, adsets: { "2005": "F1" }, ads: { "3007": "F1 · El costo" } },
      usage: { [ruleKeyOf("Promo-5-Mayo", "ad-f1-costo", null)]: 4 },
    });
    expect(row).toMatchObject({ target: "Promo Frío › F1 › F1 · El costo", touches: 4, origin: "Confirmado de una sugerencia", when: "7 nov" });
    expect(row.values).toEqual([{ label: "utm_campaign", value: "promo-5-mayo" }, { label: "utm_content", value: "ad-f1-costo" }]);
  });
  it("una regla de ignorar dice que no es un anuncio", () => {
    const [row] = buildRuleRows({ rules: [rule({ action: "ignore", ad_id: null, adset_id: null, campaign_id: null })], usage: {} });
    expect(row).toMatchObject({ target: "No es un anuncio", touches: 0 });
  });
});
