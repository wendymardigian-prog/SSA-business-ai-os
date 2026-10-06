/**
 * F81: la taxonomía de atribución.
 *
 * Lo que se fija: que los valores conocidos queden como están, que las
 * variantes sin duda se normalicen, y sobre todo que lo desconocido NO se
 * descarte (se guarda crudo) y que un medio desconocido quede marcado.
 */
import { describe, it, expect } from "vitest";
import {
  MEDIUMS,
  ORIGINS,
  SOURCES,
  isKnownMedium,
  isKnownSource,
  mediumLabel,
  normalizeMedium,
  normalizeSource,
  sourceLabel,
} from "./taxonomy";

describe("las listas cerradas (F81)", () => {
  it("fuentes: las del plano, ni una más ni una menos", () => {
    expect([...SOURCES]).toEqual([
      "instagram", "tiktok", "youtube", "linkedin", "threads", "whatsapp", "email",
      "google", "web", "referral", "direct", "manual", "csv",
    ]);
  });

  it("medios: los del plano", () => {
    expect([...MEDIUMS]).toEqual([
      "dm", "comment", "story_reply", "mention", "link_in_bio", "paid_social",
      "organic_social", "email", "form", "booking", "qr", "import",
    ]);
  });

  it("orígenes: los que acepta la columna `origin` de la base", () => {
    expect([...ORIGINS]).toEqual(["dm", "comment", "booking", "form", "manual", "import"]);
  });
});

describe("normalizeSource", () => {
  it("una fuente conocida queda igual, sin importar mayúsculas ni espacios", () => {
    expect(normalizeSource("instagram")).toBe("instagram");
    expect(normalizeSource("  Instagram ")).toBe("instagram");
    expect(normalizeSource("TIKTOK")).toBe("tiktok");
  });

  it("las variantes sin duda se normalizan", () => {
    expect(normalizeSource("ig")).toBe("instagram");
    expect(normalizeSource("yt")).toBe("youtube");
    expect(normalizeSource("tiktok.com")).toBe("tiktok");
  });

  it("un utm_source que no está en la lista se guarda CRUDO, no se descarta", () => {
    expect(normalizeSource("Facebook")).toBe("facebook");
    expect(normalizeSource("mi-newsletter-de-octubre")).toBe("mi-newsletter-de-octubre");
  });

  it("sin nada devuelve null", () => {
    expect(normalizeSource(null)).toBeNull();
    expect(normalizeSource(undefined)).toBeNull();
    expect(normalizeSource("   ")).toBeNull();
  });
});

describe("normalizeMedium", () => {
  it("un medio conocido no queda marcado como crudo", () => {
    expect(normalizeMedium("comment")).toEqual({ medium: "comment", raw: false });
    expect(normalizeMedium("DM")).toEqual({ medium: "dm", raw: false });
  });

  it("los utm_medium de uso común se mapean a uno de la lista", () => {
    expect(normalizeMedium("cpc")).toEqual({ medium: "paid_social", raw: false });
    expect(normalizeMedium("paid")).toEqual({ medium: "paid_social", raw: false });
    expect(normalizeMedium("organic")).toEqual({ medium: "organic_social", raw: false });
    expect(normalizeMedium("bio")).toEqual({ medium: "link_in_bio", raw: false });
  });

  it("un medio que no está en la lista se guarda crudo y se MARCA", () => {
    // Sin la marca, un agrupador por medio mezclaría "podcast" con los medios
    // conocidos sin avisar que no es de la lista.
    expect(normalizeMedium("podcast")).toEqual({ medium: "podcast", raw: true });
    expect(normalizeMedium("Webinar-Octubre")).toEqual({ medium: "webinar-octubre", raw: true });
  });

  it("sin nada devuelve null y no lo marca", () => {
    expect(normalizeMedium(null)).toEqual({ medium: null, raw: false });
    expect(normalizeMedium("")).toEqual({ medium: null, raw: false });
  });
});

describe("en lenguaje claro (F88)", () => {
  it("una fuente conocida tiene su nombre", () => {
    expect(sourceLabel("instagram")).toBe("Instagram");
    expect(sourceLabel("csv")).toBe("Importación");
  });

  it("una cruda se muestra tal cual, capitalizada", () => {
    expect(sourceLabel("facebook")).toBe("Facebook");
  });

  it("el `scheduling` viejo de las reservas tiene nombre propio", () => {
    expect(sourceLabel("scheduling")).toBe("Agendamiento");
  });

  it("los medios se dicen como los diría una persona", () => {
    expect(mediumLabel("comment")).toBe("comentario");
    expect(mediumLabel("story_reply")).toBe("respuesta a una historia");
    expect(mediumLabel("podcast")).toBe("podcast");
  });

  it("sin dato devuelve vacío, no un guion inventado", () => {
    expect(sourceLabel(null)).toBe("");
    expect(mediumLabel(undefined)).toBe("");
  });

  it("isKnown* distingue lo conocido de lo crudo", () => {
    expect(isKnownSource("instagram")).toBe(true);
    expect(isKnownSource("facebook")).toBe(false);
    expect(isKnownMedium("dm")).toBe(true);
    expect(isKnownMedium("podcast")).toBe(false);
  });
});
