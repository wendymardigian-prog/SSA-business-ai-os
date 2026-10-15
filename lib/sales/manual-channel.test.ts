import { describe, expect, it } from "vitest";
import { parseTouch } from "@/lib/contacts/touch";
import {
  MANUAL_CHANNELS,
  buildManualTouch,
  manualChoiceReferences,
  manualDedupeKey,
  manualOccurredAt,
  parseManualChoice,
  type ManualChoice,
} from "./manual-channel";

const PIECE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONTACT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ctx = { saleDate: "2026-10-10", timeZone: "America/Argentina/Buenos_Aires", saleKey: "sale-uuid-1" };

function choice(raw: unknown): ManualChoice {
  const parsed = parseManualChoice(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.choice;
}

describe("MANUAL_CHANNELS (la tabla del plano)", () => {
  it("tiene los cinco canales en orden, con su canal de toque", () => {
    expect(MANUAL_CHANNELS.map((c) => [c.label, c.channel])).toEqual([
      ["Contenido orgánico", "organic"],
      ["Anuncio", "paid"],
      ["Referido", "referral"],
      ["Evento o llamada en frío", "direct"],
      ["Otro / no se sabe", "direct"],
    ]);
  });

  it("organico y anuncio tienen salida 'No sé'; referido y evento exigen el detalle", () => {
    const by = Object.fromEntries(MANUAL_CHANNELS.map((c) => [c.kind, c]));
    expect(by.organic.unknownLabel).toBe("No sé qué pieza");
    expect(by.paid.unknownLabel).toBe("No sé qué anuncio");
    expect(by.referral.detailRequired).toBe(true);
    expect(by.event.detailRequired).toBe(true);
    expect(by.other.detailRequired).toBe(false);
  });
});

describe("buildManualTouch: contenido organico", () => {
  it("Reel A de Instagram: toque manual organico con la pieza y la publicacion", () => {
    const touch = buildManualTouch(choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE, socialPostId: POST, title: "Reel A" } }), ctx);
    expect(touch).toMatchObject({
      origin: "manual",
      channel: "organic",
      source: "instagram",
      medium: "organic_social",
      contentPostId: PIECE,
      socialPostId: POST,
      content: "Reel A",
      dedupeKey: "sale-manual:sale-uuid-1",
    });
  });

  it("'No sé qué pieza': solo la red", () => {
    const touch = buildManualTouch(choice({ kind: "organic", network: "tiktok", piece: null }), ctx);
    expect(touch).toMatchObject({ channel: "organic", source: "tiktok", medium: "organic_social", contentPostId: null, socialPostId: null, content: null });
  });

  it("la red 'otra' se guarda como alta manual", () => {
    expect(buildManualTouch(choice({ kind: "organic", network: "other" }), ctx).source).toBe("manual");
  });

  it("una pieza sin publicacion no inventa una", () => {
    const touch = buildManualTouch(choice({ kind: "organic", network: "youtube", piece: { contentPostId: PIECE } }), ctx);
    expect(touch).toMatchObject({ contentPostId: PIECE, socialPostId: null, content: null });
  });
});

describe("buildManualTouch: anuncio", () => {
  it("con anuncio: los tres ids", () => {
    const touch = buildManualTouch(choice({ kind: "paid", network: "facebook", ad: { adId: "123", adsetId: "456", campaignId: "789" } }), ctx);
    expect(touch).toMatchObject({ channel: "paid", source: "facebook", medium: "paid_social", adId: "123", adsetId: "456", campaignId: "789" });
  });

  it("'No sé qué anuncio': solo la red, y sigue siendo pauta", () => {
    const touch = buildManualTouch(choice({ kind: "paid", network: "instagram", ad: null }), ctx);
    expect(touch).toMatchObject({ channel: "paid", source: "instagram", medium: "paid_social", adId: null, adsetId: null, campaignId: null });
  });

  it("solo la campania alcanza", () => {
    expect(buildManualTouch(choice({ kind: "paid", network: "facebook", ad: { campaignId: "789" } }), ctx)).toMatchObject({ campaignId: "789", adId: null });
  });
});

describe("buildManualTouch: referido, evento y otro", () => {
  it("referido por un contacto", () => {
    const touch = buildManualTouch(choice({ kind: "referral", referrer: { type: "contact", contactId: CONTACT } }), ctx);
    expect(touch).toMatchObject({ channel: "referral", source: "referral", medium: "referral_person", raw: { channel: "referral", referrer_contact_id: CONTACT } });
    expect((touch.raw as Record<string, unknown>).referrer_user_id).toBeUndefined();
  });

  it("referido por una persona del equipo", () => {
    const touch = buildManualTouch(choice({ kind: "referral", referrer: { type: "member", userId: USER } }), ctx);
    expect(touch.raw).toEqual({ channel: "referral", referrer_user_id: USER });
  });

  it("evento: directo, medium event, campania = el nombre", () => {
    expect(buildManualTouch(choice({ kind: "event", name: "  Expo Marketing 2026 " }), ctx)).toMatchObject({
      channel: "direct",
      medium: "event",
      campaign: "Expo Marketing 2026",
    });
  });

  it("otro: directo, medium other, con o sin texto", () => {
    expect(buildManualTouch(choice({ kind: "other", note: "Lo conoció en un cumpleaños" }), ctx)).toMatchObject({ channel: "direct", medium: "other", campaign: "Lo conoció en un cumpleaños" });
    expect(buildManualTouch(choice({ kind: "other" }), ctx)).toMatchObject({ channel: "direct", medium: "other", campaign: null });
    expect(buildManualTouch(choice({ kind: "other", note: "   " }), ctx).campaign).toBeNull();
  });
});

describe("buildManualTouch: avanzado (UTM)", () => {
  it("calcula el canal con touchChannel", () => {
    const pauta = buildManualTouch(choice({ kind: "utm", source: "instagram", medium: "paid_social", campaign: "octubre", content: "video", term: "" }), ctx);
    expect(pauta).toMatchObject({ channel: "paid", source: "instagram", medium: "paid_social", campaign: "octubre", content: "video", term: null });
    const directo = buildManualTouch(choice({ kind: "utm", source: "web" }), ctx);
    expect(directo).toMatchObject({ channel: "direct", medium: null });
    const organico = buildManualTouch(choice({ kind: "utm", source: "instagram", medium: "organic_social" }), ctx);
    expect(organico.channel).toBe("organic");
  });
});

describe("buildManualTouch: fecha y clave", () => {
  it("occurredAt es la fecha de la venta a las 12:00 locales", () => {
    // Buenos Aires es UTC-3 todo el año: 12:00 locales = 15:00 UTC.
    expect(buildManualTouch(choice({ kind: "other" }), ctx).occurredAt).toBe("2026-10-10T15:00:00.000Z");
    expect(buildManualTouch(choice({ kind: "other" }), { ...ctx, timeZone: "UTC" }).occurredAt).toBe("2026-10-10T12:00:00.000Z");
    // Costa Rica es UTC-6.
    expect(manualOccurredAt("2026-10-10", "America/Costa_Rica")).toBe("2026-10-10T18:00:00.000Z");
  });

  it("acepta un instante: lo lleva a su fecha local", () => {
    // 2026-10-11T01:00Z es todavia el 10/10 a las 22:00 en Buenos Aires.
    expect(manualOccurredAt("2026-10-11T01:00:00Z", "America/Argentina/Buenos_Aires")).toBe("2026-10-10T15:00:00.000Z");
  });

  it("una fecha que no existe o una clave vacia lanzan (son datos del servidor)", () => {
    expect(() => manualOccurredAt("2026-02-31", "UTC")).toThrow(RangeError);
    expect(() => manualOccurredAt("ayer", "UTC")).toThrow();
    expect(() => buildManualTouch(choice({ kind: "other" }), { ...ctx, saleKey: "  " })).toThrow(RangeError);
    expect(() => buildManualTouch(choice({ kind: "other" }), { ...ctx, saleKey: "x".repeat(151) })).toThrow(RangeError);
  });

  it("la clave de deduplicacion es sale-manual:<saleKey> y es la misma si se envia dos veces", () => {
    expect(manualDedupeKey("abc")).toBe("sale-manual:abc");
    const c = choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE } });
    expect(buildManualTouch(c, ctx).dedupeKey).toBe(buildManualTouch(c, ctx).dedupeKey);
    expect(buildManualTouch(c, { ...ctx, saleKey: "otra" }).dedupeKey).not.toBe(buildManualTouch(c, ctx).dedupeKey);
  });
});

describe("el toque es aceptado por parseTouch (lo que registra recordTouch)", () => {
  const choices: unknown[] = [
    { kind: "organic", network: "instagram", piece: { contentPostId: PIECE, socialPostId: POST, title: "Reel A" } },
    { kind: "organic", network: "other" },
    { kind: "paid", network: "facebook", ad: { adId: "1", adsetId: "2", campaignId: "3" } },
    { kind: "paid", network: "instagram" },
    { kind: "referral", referrer: { type: "contact", contactId: CONTACT } },
    { kind: "event", name: "Expo" },
    { kind: "other", note: "x" },
    { kind: "utm", source: "google", medium: "email" },
  ];

  it.each(choices.map((c) => [(c as { kind: string }).kind, c] as const))("%s", (_kind, raw) => {
    const touch = buildManualTouch(choice(raw), ctx);
    const parsed = parseTouch(touch);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.touch.origin).toBe("manual");
      expect(parsed.touch.dedupe_key).toBe("sale-manual:sale-uuid-1");
      expect(parsed.touch.occurred_at).toBe("2026-10-10T15:00:00.000Z");
    }
  });
});

describe("parseManualChoice (validacion de la forma)", () => {
  it("rechaza lo que no es una eleccion", () => {
    for (const bad of [null, undefined, "x", 5, {}, { kind: "otra-cosa" }]) {
      expect(parseManualChoice(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("organico: la red es obligatoria y la pieza tiene que ser un UUID", () => {
    expect(parseManualChoice({ kind: "organic" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "organic", network: "snapchat" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "organic", network: "instagram", piece: { contentPostId: "no-uuid" } }).ok).toBe(false);
    expect(parseManualChoice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE, socialPostId: "x" } }).ok).toBe(false);
  });

  it("anuncio: Facebook o Instagram, y si hay anuncio, al menos un id", () => {
    expect(parseManualChoice({ kind: "paid", network: "tiktok" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "paid", network: "facebook", ad: {} }).ok).toBe(false);
    expect(parseManualChoice({ kind: "paid", network: "facebook", ad: { adId: "  " } }).ok).toBe(false);
    expect(parseManualChoice({ kind: "paid", network: "facebook", ad: { adId: "1" } }).ok).toBe(true);
  });

  it("referido: hace falta un contacto o una persona validos", () => {
    expect(parseManualChoice({ kind: "referral" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "referral", referrer: { type: "contact" } }).ok).toBe(false);
    expect(parseManualChoice({ kind: "referral", referrer: { type: "member", userId: "x" } }).ok).toBe(false);
    expect(parseManualChoice({ kind: "referral", referrer: { type: "otro", id: CONTACT } }).ok).toBe(false);
  });

  it("evento: el nombre es obligatorio y de hasta 120", () => {
    expect(parseManualChoice({ kind: "event" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "event", name: "   " }).ok).toBe(false);
    expect(parseManualChoice({ kind: "event", name: "x".repeat(121) }).ok).toBe(false);
    const ok = parseManualChoice({ kind: "event", name: "x".repeat(120) });
    expect(ok.ok).toBe(true);
  });

  it("otro: la nota es de hasta 200", () => {
    expect(parseManualChoice({ kind: "other", note: "x".repeat(201) }).ok).toBe(false);
    expect(parseManualChoice({ kind: "other", note: null }).ok).toBe(true);
  });

  it("avanzado: la fuente es de la lista cerrada", () => {
    expect(parseManualChoice({ kind: "utm", source: "inventada" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "utm", source: "instagram", medium: "inventado" }).ok).toBe(false);
    expect(parseManualChoice({ kind: "utm", source: "instagram", medium: "" }).ok).toBe(true);
  });

  it("el mensaje de error esta en español y listo para mostrar", () => {
    const bad = parseManualChoice({ kind: "event", name: "" });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toBe("Escribí el nombre del evento");
  });

  it("recorta los textos", () => {
    const c = choice({ kind: "organic", network: "instagram", piece: { contentPostId: ` ${PIECE} `, title: "  Reel A  " } });
    expect(c.kind === "organic" && c.piece).toMatchObject({ contentPostId: PIECE, title: "Reel A" });
  });
});

describe("manualChoiceReferences (lo que el servidor tiene que comprobar)", () => {
  it("lista los ids de cada eleccion", () => {
    expect(manualChoiceReferences(choice({ kind: "organic", network: "instagram", piece: { contentPostId: PIECE, socialPostId: POST } }))).toMatchObject({ contentPostId: PIECE, socialPostId: POST });
    expect(manualChoiceReferences(choice({ kind: "paid", network: "facebook", ad: { adId: "1", campaignId: "3" } }))).toMatchObject({ adId: "1", adsetId: null, campaignId: "3" });
    expect(manualChoiceReferences(choice({ kind: "referral", referrer: { type: "contact", contactId: CONTACT } }))).toMatchObject({ referrerContactId: CONTACT, referrerUserId: null });
    expect(manualChoiceReferences(choice({ kind: "referral", referrer: { type: "member", userId: USER } }))).toMatchObject({ referrerContactId: null, referrerUserId: USER });
  });

  it("sin referencias, todo null", () => {
    expect(Object.values(manualChoiceReferences(choice({ kind: "event", name: "Expo" }))).every((v) => v === null)).toBe(true);
    expect(Object.values(manualChoiceReferences(choice({ kind: "organic", network: "instagram" }))).every((v) => v === null)).toBe(true);
  });
});
