import { describe, expect, it } from "vitest";
import { draftKindLabel, draftToChoice, EMPTY_DRAFT, type ManualDraft } from "./manual-channel-draft";

const PIECE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const draft = (over: Partial<ManualDraft>): ManualDraft => ({ ...EMPTY_DRAFT, ...over });

describe("draftToChoice (el selector de dos pasos)", () => {
  it("sin canal elegido no hay nada para usar", () => {
    expect(draftToChoice(EMPTY_DRAFT)).toEqual({ ready: false, hint: "Elegí de dónde vino" });
  });

  it("orgánico: pide la red y la pieza (o «No sé qué pieza»)", () => {
    expect(draftToChoice(draft({ kind: "organic" }))).toMatchObject({ ready: false, hint: "Elegí la red" });
    expect(draftToChoice(draft({ kind: "organic", organicNetwork: "instagram" }))).toMatchObject({ ready: false });
    const withPiece = draftToChoice(draft({ kind: "organic", organicNetwork: "instagram", piece: { contentPostId: PIECE, title: "Reel A" } }));
    expect(withPiece).toMatchObject({ ready: true, label: "Contenido orgánico · Instagram · Reel A" });
    const unknown = draftToChoice(draft({ kind: "organic", organicNetwork: "tiktok", unknownPiece: true }));
    expect(unknown.ready && unknown.choice).toEqual({ kind: "organic", network: "tiktok", piece: null });
  });

  it("anuncio: la red y el anuncio del catálogo (o «No sé qué anuncio»)", () => {
    expect(draftToChoice(draft({ kind: "paid", paidNetwork: "facebook" }))).toMatchObject({ ready: false });
    const ad = draftToChoice(draft({ kind: "paid", paidNetwork: "facebook", ad: { adId: "1", adsetId: "2", campaignId: "3", label: "Camp › Conj › Anuncio" } }));
    expect(ad).toMatchObject({ ready: true, choice: { kind: "paid", network: "facebook", ad: { adId: "1", adsetId: "2", campaignId: "3" } } });
    expect(draftToChoice(draft({ kind: "paid", paidNetwork: "instagram", unknownAd: true })).ready).toBe(true);
  });

  it("referido: un contacto o una persona del equipo", () => {
    expect(draftToChoice(draft({ kind: "referral" }))).toMatchObject({ ready: false, hint: "Elegí quién lo recomendó" });
    const byContact = draftToChoice(draft({ kind: "referral", referrer: { type: "contact", id: CONTACT, name: "Ana" } }));
    expect(byContact).toMatchObject({ ready: true, choice: { kind: "referral", referrer: { type: "contact", contactId: CONTACT } } });
    const byMember = draftToChoice(draft({ kind: "referral", referrerMode: "member", referrer: { type: "member", id: USER, name: "Leo" } }));
    expect(byMember).toMatchObject({ ready: true, choice: { kind: "referral", referrer: { type: "member", userId: USER } } });
  });

  it("evento: el nombre es obligatorio; otro: la nota es opcional", () => {
    expect(draftToChoice(draft({ kind: "event", eventName: "  " }))).toMatchObject({ ready: false, hint: "Escribí el nombre del evento" });
    expect(draftToChoice(draft({ kind: "event", eventName: "Expo 2026" }))).toMatchObject({ ready: true, label: "Evento o llamada en frío · Expo 2026" });
    expect(draftToChoice(draft({ kind: "other" })).ready).toBe(true);
  });

  it("avanzado: la fuente es obligatoria y del listado", () => {
    expect(draftToChoice(draft({ kind: "utm" }))).toMatchObject({ ready: false, hint: "Elegí la fuente" });
    const ok = draftToChoice(draft({ kind: "utm", utm: { source: "instagram", medium: "paid_social", campaign: "octubre", content: "", term: "" } }));
    expect(ok.ready).toBe(true);
  });

  it("un id que no es válido no pasa aunque el borrador esté completo", () => {
    expect(draftToChoice(draft({ kind: "organic", organicNetwork: "instagram", piece: { contentPostId: "no-uuid", title: "x" } })).ready).toBe(false);
  });

  it("cada canal tiene nombre", () => {
    expect(draftKindLabel("utm")).toBe("Avanzado (UTM)");
    expect(draftKindLabel("referral")).toBe("Referido");
  });
});
