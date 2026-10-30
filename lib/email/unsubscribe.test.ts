import { describe, it, expect } from "vitest";
import { finalizeEmailHtml } from "./html";
import {
  marketingFooterHtml,
  marketingFooterText,
  oneClickUrl,
  protectUnsubscribeVariable,
  resolveUnsubscribeLink,
  UNSUBSCRIBE_PLACEHOLDER,
  unsubscribeHeaders,
  unsubscribePageUrl,
  usesUnsubscribeLink,
  withUnsubscribe,
} from "./unsubscribe";

const APP = "https://app.negocio.test/";
const TOKEN = "3f1c2a7e-1111-4222-8333-944445555666";

describe("las direcciones de la baja", () => {
  it("la pagina y el endpoint de un clic, sin barra doble", () => {
    expect(unsubscribePageUrl(APP, TOKEN)).toBe(`https://app.negocio.test/baja/${TOKEN}`);
    expect(oneClickUrl(APP, TOKEN)).toBe(`https://app.negocio.test/api/email/baja/${TOKEN}`);
  });

  it("las cabeceras de RFC 8058: solo https, con el POST de un clic", () => {
    expect(unsubscribeHeaders("https://x.test/api/email/baja/t")).toEqual({
      "List-Unsubscribe": "<https://x.test/api/email/baja/t>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("el pie", () => {
  it("dice por que le llega, con la marca y el link; la direccion postal si esta", () => {
    const html = marketingFooterHtml({ brandName: "Mi <Negocio>", url: "https://x.test/baja/t", postalAddress: "Av. Siempre Viva 742" });
    expect(html).toContain("Recibís este email porque te registraste en Mi &lt;Negocio&gt;.");
    expect(html).toContain('href="https://x.test/baja/t"');
    expect(html).toContain("Darme de baja");
    expect(html).toContain("Av. Siempre Viva 742");
  });

  it("sin direccion postal no queda un renglon vacio", () => {
    expect(marketingFooterHtml({ brandName: "N", url: "https://x.test/b" })).not.toContain("margin:6px 0 0");
  });

  it("tambien en texto plano", () => {
    expect(marketingFooterText({ brandName: "N", url: "https://x.test/b", postalAddress: "Calle 1" })).toContain("Para darte de baja: https://x.test/b\nCalle 1");
  });
});

describe("la variable {{unsubscribe_url}}", () => {
  it("sobrevive al limpiador del HTML gracias al marcador (un href {{...}} se descartaria)", () => {
    const body = '<p>Si no querés más, <a href="{{unsubscribe_url}}">tocá acá</a>.</p>';
    const clean = finalizeEmailHtml(protectUnsubscribeVariable(body), true);
    expect(clean).toContain(`href="${UNSUBSCRIBE_PLACEHOLDER}"`);
    expect(resolveUnsubscribeLink(clean, "https://x.test/baja/t")).toContain('href="https://x.test/baja/t"');
  });

  it("acepta espacios adentro de las llaves y se reconoce como 'ya usa el link'", () => {
    expect(usesUnsubscribeLink("Baja: {{ unsubscribe_url }}")).toBe(true);
    expect(usesUnsubscribeLink(`<a href="${UNSUBSCRIBE_PLACEHOLDER}">`)).toBe(true);
    expect(usesUnsubscribeLink("nada")).toBe(false);
  });

  it("sin link (no hay token), la variable queda vacia en vez de un link roto", () => {
    expect(resolveUnsubscribeLink(`Baja: ${UNSUBSCRIBE_PLACEHOLDER} y {{unsubscribe_url}}`, null)).toBe("Baja:  y ");
  });
});

describe("withUnsubscribe: pie y cabeceras solo en marketing", () => {
  const base = { appUrl: APP, brandName: "Mi Negocio" };

  it("marketing con token: link real, pie y cabeceras", () => {
    const out = withUnsubscribe({ ...base, html: "<p>Hola</p>", category: "marketing", token: TOKEN });
    expect(out.html).toContain("<p>Hola</p>");
    expect(out.html).toContain(`/baja/${TOKEN}`);
    expect(out.html).toContain("Darme de baja");
    expect(out.headers["List-Unsubscribe"]).toBe(`<https://app.negocio.test/api/email/baja/${TOKEN}>`);
    expect(out.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("si la plantilla ya usa el link, no se duplica el pie (pero las cabeceras van igual)", () => {
    const out = withUnsubscribe({ ...base, html: `<p><a href="${UNSUBSCRIBE_PLACEHOLDER}">Baja</a></p>`, category: "marketing", token: TOKEN });
    expect(out.html).not.toContain("Recibís este email");
    expect(out.html).toContain(`/baja/${TOKEN}`);
    expect(Object.keys(out.headers)).toHaveLength(2);
  });

  it("transaccional: ni pie ni cabeceras; el cuerpo sale igual", () => {
    const out = withUnsubscribe({ ...base, html: "<p>Tu reunión</p>", category: "transactional", token: TOKEN });
    expect(out).toEqual({ html: "<p>Tu reunión</p>", headers: {} });
  });

  it("marketing sin token (una direccion que no es de ningun contacto): sin pie ni cabeceras", () => {
    const out = withUnsubscribe({ ...base, html: "<p>Hola</p>", category: "marketing", token: null });
    expect(out).toEqual({ html: "<p>Hola</p>", headers: {} });
  });
});
