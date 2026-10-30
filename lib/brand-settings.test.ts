import { describe, it, expect } from "vitest";
import { brandLogoPath, isOwnLogoPath, parseBrandLogo, parseBrandSettings } from "./brand-settings";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

describe("parseBrandSettings", () => {
  it("vacio = NULL = la marca de la instalacion", () => {
    expect(parseBrandSettings({ name: "  ", color: "", languageStyle: undefined })).toEqual({
      ok: true,
      values: { brand_name: null, brand_color: null, ai_language_style: null },
    });
  });

  it("recorta espacios y pasa el color a minusculas", () => {
    expect(parseBrandSettings({ name: "  Business  Xcelerator ", color: "#AABBCC", languageStyle: " español neutro " })).toEqual({
      ok: true,
      values: { brand_name: "Business Xcelerator", brand_color: "#aabbcc", ai_language_style: "español neutro" },
    });
  });

  it("rechaza un color que no es #rrggbb, con un mensaje claro", () => {
    const r = parseBrandSettings({ color: "rojo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("#1a73e8");
  });

  it("rechaza un nombre o un tono demasiado largos", () => {
    expect(parseBrandSettings({ name: "x".repeat(61) }).ok).toBe(false);
    expect(parseBrandSettings({ languageStyle: "x".repeat(201) }).ok).toBe(false);
  });
});

describe("parseBrandLogo", () => {
  it("acepta un PNG por sus bytes", () => {
    const r = parseBrandLogo(dataUrl(PNG, "image/png"));
    expect(r).toMatchObject({ ok: true, ext: "png", mime: "image/png" });
  });

  it("el tipo sale de los bytes, no de lo que dice el navegador", () => {
    expect(parseBrandLogo(dataUrl(PNG, "image/jpeg"))).toMatchObject({ ok: true, ext: "png" });
  });

  it("rechaza un SVG (puede llevar codigo) aunque diga ser PNG", () => {
    expect(parseBrandLogo(dataUrl(SVG, "image/png")).ok).toBe(false);
    expect(parseBrandLogo(dataUrl(SVG, "image/svg+xml")).ok).toBe(false);
  });

  it("rechaza mas de 500 KB y lo que no es una data URL", () => {
    const big = Buffer.concat([PNG, Buffer.alloc(500 * 1024)]);
    expect(parseBrandLogo(dataUrl(big, "image/png")).ok).toBe(false);
    expect(parseBrandLogo("https://ejemplo.com/logo.png").ok).toBe(false);
    expect(parseBrandLogo(null).ok).toBe(false);
  });
});

describe("la ruta del logo", () => {
  it("vive en la carpeta del workspace, como exige el CHECK de la 00266", () => {
    expect(brandLogoPath("ws-1", "abc", "png")).toBe("ws-1/logo/abc.png");
  });

  it("solo se borra un logo del MISMO workspace", () => {
    expect(isOwnLogoPath("ws-1", "ws-1/logo/abc.png")).toBe(true);
    expect(isOwnLogoPath("ws-1", "ws-2/logo/abc.png")).toBe(false);
    expect(isOwnLogoPath("ws-1", "ws-1/logo/../../ws-2/logo/x.png")).toBe(false);
    expect(isOwnLogoPath("ws-1", null)).toBe(false);
  });
});

describe("parseBrandSettings: la direccion del pie de los emails (suscripcion a emails)", () => {
  it("se guarda limpia; vacia = NULL; sin mandarla, no se toca", () => {
    expect(parseBrandSettings({ footerAddress: "  Av. Siempre Viva 742  " })).toMatchObject({ ok: true, values: { email_footer_address: "Av. Siempre Viva 742" } });
    expect(parseBrandSettings({ footerAddress: "  " })).toMatchObject({ ok: true, values: { email_footer_address: null } });
    const without = parseBrandSettings({ name: "X" });
    expect(without.ok && "email_footer_address" in without.values).toBe(false);
  });

  it("con el mismo tope que el CHECK de la base", () => {
    expect(parseBrandSettings({ footerAddress: "x".repeat(301) })).toMatchObject({ ok: false });
  });
});
