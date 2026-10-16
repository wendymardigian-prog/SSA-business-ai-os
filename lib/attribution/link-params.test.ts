import { describe, expect, it } from "vitest";
import {
  attributeText,
  attributionParams,
  buildAttributedUrl,
  campaignSlug,
  describeAttributionExample,
  flowCode,
  isChatLink,
  mapUrlsInText,
  type LinkAttributionContext,
} from "./link-params";

const FLOW_ID = "9f3a1c7e-1111-4222-8333-444455556666";
const ctx: LinkAttributionContext = { platform: "instagram", flowName: "Info Reel", flowId: FLOW_ID, contentCode: "c8k2f" };
const noPiece: LinkAttributionContext = { ...ctx, contentCode: null };

describe("buildAttributedUrl", () => {
  it("agrega los cuatro parametros", () => {
    expect(buildAttributedUrl("https://example.com/programa", ctx)).toBe(
      "https://example.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f",
    );
  });

  it("conserva utm_source=bio y el #hash, y agrega los otros tres", () => {
    const out = buildAttributedUrl("https://a.com/p?utm_source=bio#x", ctx);
    expect(out).toBe("https://a.com/p?utm_source=bio&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f#x");
    const u = new URL(out);
    expect(u.searchParams.get("utm_source")).toBe("bio");
    expect(u.hash).toBe("#x");
    expect([...u.searchParams.keys()].sort()).toEqual(["utm_campaign", "utm_content", "utm_medium", "utm_source"]);
  });

  it("sin pieza, utm_content es f- y los primeros 8 del id del flujo", () => {
    const out = new URL(buildAttributedUrl("https://a.com/p", noPiece));
    expect(out.searchParams.get("utm_content")).toBe("f-9f3a1c7e");
    expect(out.searchParams.get("utm_content")).toMatch(/^f-[a-z0-9]{8}$/);
  });

  it("nunca pisa un parametro que ya trae, aunque este vacio o con otras mayusculas", () => {
    expect(buildAttributedUrl("https://a.com/p?utm_campaign=mia&utm_content=", ctx)).toBe(
      "https://a.com/p?utm_campaign=mia&utm_content=&utm_source=instagram&utm_medium=dm",
    );
    expect(buildAttributedUrl("https://a.com/p?UTM_Source=bio", ctx)).toContain("UTM_Source=bio&utm_medium=dm");
    expect(buildAttributedUrl("https://a.com/p?UTM_Source=bio", ctx)).not.toContain("utm_source=");
  });

  it("si ya trae los cuatro, devuelve la URL igual", () => {
    const url = "https://a.com/p?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d#z";
    expect(buildAttributedUrl(url, ctx)).toBe(url);
  });

  it("respeta otros parametros y arma bien con ? o & finales", () => {
    expect(buildAttributedUrl("https://a.com/p?ref=1", ctx)).toBe("https://a.com/p?ref=1&utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f");
    expect(buildAttributedUrl("https://a.com/p?", ctx)).toBe("https://a.com/p?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f");
    expect(buildAttributedUrl("https://a.com/p?ref=1&", ctx)).toBe("https://a.com/p?ref=1&utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f");
  });

  it("no re-serializa lo que ya estaba (un dominio pelado no gana una barra)", () => {
    expect(buildAttributedUrl("https://a.com", ctx).startsWith("https://a.com?utm_source=")).toBe(true);
    expect(buildAttributedUrl("https://a.com/ruta%20rara/?q=a%20b", ctx).startsWith("https://a.com/ruta%20rara/?q=a%20b&utm_source=")).toBe(true);
  });

  it("el hash sin consulta queda al final", () => {
    expect(buildAttributedUrl("https://a.com/p#seccion", ctx)).toBe("https://a.com/p?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f#seccion");
  });

  it("no toca lo que no es http(s)", () => {
    for (const url of ["mailto:hola@a.com", "tel:+5491100000000", "ftp://a.com/x", "javascript:alert(1)", "/ruta/relativa", "a.com/sin-esquema", "", "tg://resolve"]) {
      expect(buildAttributedUrl(url, ctx), url).toBe(url);
    }
  });

  it("no toca los links de chat: wa.me, m.me, instagram.com, ig.me, api.whatsapp.com", () => {
    for (const url of [
      "https://wa.me/123",
      "https://wa.me/5491100000000?text=hola",
      "https://m.me/mi-pagina",
      "https://www.instagram.com/ejemplo/",
      "https://instagram.com/p/abc",
      "https://ig.me/m/ejemplo",
      "https://api.whatsapp.com/send?phone=1",
    ]) {
      expect(buildAttributedUrl(url, ctx), url).toBe(url);
    }
  });

  it("un dominio parecido NO es de chat", () => {
    expect(buildAttributedUrl("https://notinstagram.com/x", ctx)).toContain("utm_source=instagram");
    expect(buildAttributedUrl("https://wa.me.evil.com/x", ctx)).toContain("utm_medium=dm");
  });

  it("nunca lanza", () => {
    expect(buildAttributedUrl("https://", ctx)).toBe("https://");
    expect(buildAttributedUrl(undefined as unknown as string, ctx)).toBeUndefined();
    expect(buildAttributedUrl("https://a.com/p", { platform: null, flowName: null, flowId: null })).toBe("https://a.com/p?utm_medium=dm");
  });

  it("codifica los valores", () => {
    const out = buildAttributedUrl("https://a.com/p", { ...ctx, contentCode: "a b&c" });
    expect(out).toContain("utm_content=a%20b%26c");
  });
});

describe("campaignSlug / flowCode / attributionParams", () => {
  it("slug sin tildes, en minusculas y de hasta 60 caracteres", () => {
    expect(campaignSlug("Info del Reel: ¡Cómo vender más!")).toBe("info-del-reel-como-vender-mas");
    expect(campaignSlug("a".repeat(100))).toHaveLength(60);
    expect(campaignSlug("x".repeat(59) + " zzz")).not.toMatch(/-$/);
    expect(campaignSlug("🔥🔥")).toBe("");
    expect(campaignSlug(null)).toBe("");
  });

  it("flowCode toma 8 caracteres del id", () => {
    expect(flowCode(FLOW_ID)).toBe("f-9f3a1c7e");
    expect(flowCode("")).toBe("");
    expect(flowCode(null)).toBe("");
  });

  it("un nombre sin letras cae al codigo del flujo; sin plataforma no hay utm_source", () => {
    const params = attributionParams({ platform: "", flowName: "🔥", flowId: FLOW_ID });
    expect(params).toEqual([
      { key: "utm_medium", value: "dm" },
      { key: "utm_campaign", value: "f-9f3a1c7e" },
      { key: "utm_content", value: "f-9f3a1c7e" },
    ]);
  });

  it("la plataforma se normaliza", () => {
    expect(attributionParams({ platform: " WhatsApp ", flowName: "x", flowId: FLOW_ID })[0]).toEqual({ key: "utm_source", value: "whatsapp" });
  });
});

describe("isChatLink", () => {
  it("reconoce los de chat y trata como 'no tocar' lo que no se puede leer", () => {
    expect(isChatLink("https://wa.me/1")).toBe(true);
    expect(isChatLink("https://a.com")).toBe(false);
    expect(isChatLink("no es url")).toBe(true);
  });
});

describe("attributeText / mapUrlsInText", () => {
  it("reemplaza cada link http(s) del texto y deja el resto", () => {
    const out = attributeText("Mira https://a.com/p y tambien https://b.com/q?x=1. Escribime a https://wa.me/123 !", ctx);
    expect(out).toBe(
      "Mira https://a.com/p?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f y tambien https://b.com/q?x=1&utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f. Escribime a https://wa.me/123 !",
    );
  });

  it("la puntuacion final no es parte del link", () => {
    expect(attributeText("(ver https://a.com/p).", ctx)).toBe("(ver https://a.com/p?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f).");
    expect(attributeText("¿https://a.com/p?", ctx)).toContain("utm_content=c8k2f?");
  });

  it("un ) final es del link si el link abre un (", () => {
    expect(attributeText("https://es.wikipedia.org/wiki/Foo_(bar)", ctx)).toBe("https://es.wikipedia.org/wiki/Foo_(bar)?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f");
  });

  it("un texto sin links, o vacio, queda igual", () => {
    expect(attributeText("hola, como estas?", ctx)).toBe("hola, como estas?");
    expect(attributeText("", ctx)).toBe("");
  });

  it("mapUrlsInText deja componer otra transformacion (por ejemplo, el link con seguimiento)", () => {
    expect(mapUrlsInText("ir a https://a.com/x ya", (u) => `https://app.test/l/${encodeURIComponent(u)}`)).toBe("ir a https://app.test/l/https%3A%2F%2Fa.com%2Fx ya");
  });

  it("si la transformacion lanza, ese link queda como estaba", () => {
    expect(mapUrlsInText("x https://a.com y", () => { throw new Error("no"); })).toBe("x https://a.com y");
  });
});

describe("describeAttributionExample", () => {
  it("con pieza: el ejemplo del plano", () => {
    const ex = describeAttributionExample({ ctx, exampleUrl: "https://example.com/programa", pieceTitle: "Reel: 3 errores al vender" });
    expect(ex.text).toBe(
      "Con un comentario en «Reel: 3 errores al vender», el link `https://example.com/programa` sale como `https://example.com/programa?utm_source=instagram&utm_medium=dm&utm_campaign=info-reel&utm_content=c8k2f`.",
    );
    expect(ex.contentNote).toBeNull();
    expect(ex.params.map((p) => p.key)).toEqual(["utm_source", "utm_medium", "utm_campaign", "utm_content"]);
    expect(ex.before).toBe("https://example.com/programa");
    expect(ex.after).toContain("utm_content=c8k2f");
  });

  it("sin pieza: explica que utm_content es el codigo del flujo", () => {
    const ex = describeAttributionExample({ ctx: noPiece, exampleUrl: "https://example.com/programa" });
    expect(ex.contentNote).toBe("utm_content = el código del flujo (`f-9f3a1c7e`) porque este flujo no arranca desde una pieza.");
    expect(ex.text.startsWith("Con un comentario, el link")).toBe(true);
    expect(ex.text.endsWith(ex.contentNote!)).toBe(true);
    expect(ex.after).toContain("utm_content=f-9f3a1c7e");
  });

  it("usa un link de muestra y un disparador a medida", () => {
    const ex = describeAttributionExample({ ctx, triggerLabel: "una respuesta a tu historia" });
    expect(ex.before).toBe("https://tu-sitio.com/programa");
    expect(ex.text.startsWith("Con una respuesta a tu historia en una pieza, el link")).toBe(true);
  });
});

describe("el medio del link (F42)", () => {
  it("por defecto es dm; un link de una pieza puede pedir organic_social", () => {
    expect(attributionParams({ platform: "instagram", flowName: "x", flowId: null, contentCode: "c8k2f" }).find((p) => p.key === "utm_medium")?.value).toBe("dm");
    expect(buildAttributedUrl("https://a.com/p", { platform: "instagram", flowName: "Mi reel", flowId: null, contentCode: "c8k2f", medium: "organic_social" })).toBe(
      "https://a.com/p?utm_source=instagram&utm_medium=organic_social&utm_campaign=mi-reel&utm_content=c8k2f",
    );
  });
});
