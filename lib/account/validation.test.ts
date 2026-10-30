import { describe, expect, it } from "vitest";
import {
  effectiveWhatsApp,
  parseAvatarDataUrl,
  parseContactInput,
  parseDisplayName,
  parseNewPassword,
  parsePasswordChange,
} from "./validation";
import { isOwnAvatarPath, userAvatarPath } from "./avatar";

describe("parseDisplayName", () => {
  it("limpia los espacios de mas", () => {
    expect(parseDisplayName("  Ana   María  ")).toEqual({ ok: true, value: "Ana María" });
  });
  it("rechaza vacio, solo espacios y algo que no es texto", () => {
    expect(parseDisplayName("").ok).toBe(false);
    expect(parseDisplayName("   ").ok).toBe(false);
    expect(parseDisplayName(42).ok).toBe(false);
  });
  it("tope de 80 caracteres", () => {
    expect(parseDisplayName("a".repeat(80)).ok).toBe(true);
    expect(parseDisplayName("a".repeat(81)).ok).toBe(false);
  });
});

describe("parseContactInput", () => {
  it("normaliza el telefono y usa el mismo para WhatsApp", () => {
    expect(parseContactInput({ phone: "+54 9 11 2233-4455", sameAsPhone: true })).toEqual({
      ok: true,
      value: { phone: "+5491122334455", whatsapp_phone: null, whatsapp_same_as_phone: true },
    });
  });
  it("vacio = sin dato", () => {
    expect(parseContactInput({ phone: "  " })).toEqual({
      ok: true,
      value: { phone: null, whatsapp_phone: null, whatsapp_same_as_phone: true },
    });
  });
  it("WhatsApp distinto", () => {
    expect(parseContactInput({ phone: "", whatsappPhone: "0054 9 11 5555 6666", sameAsPhone: false })).toEqual({
      ok: true,
      value: { phone: null, whatsapp_phone: "+5491155556666", whatsapp_same_as_phone: false },
    });
  });
  it("rechaza un numero sin codigo de pais o con basura", () => {
    expect(parseContactInput({ phone: "1234" }).ok).toBe(false);
    expect(parseContactInput({ phone: "+54", sameAsPhone: true }).ok).toBe(false);
    expect(parseContactInput({ phone: "", whatsappPhone: "hola", sameAsPhone: false }).ok).toBe(false);
  });
});

describe("effectiveWhatsApp", () => {
  it("con 'es el mismo' usa el telefono", () => {
    expect(effectiveWhatsApp({ phone: "+1", whatsapp_phone: "+2", whatsapp_same_as_phone: true })).toBe("+1");
  });
  it("si no, el WhatsApp propio", () => {
    expect(effectiveWhatsApp({ phone: "+1", whatsapp_phone: "+2", whatsapp_same_as_phone: false })).toBe("+2");
    expect(effectiveWhatsApp({ phone: "+1", whatsapp_phone: null, whatsapp_same_as_phone: false })).toBeNull();
  });
  it("sin perfil, nada", () => {
    expect(effectiveWhatsApp(null)).toBeNull();
  });
});

describe("contraseñas", () => {
  it("cambiar: pide la actual, minimo 8, que coincidan y que sea distinta", () => {
    expect(parsePasswordChange({ current: "", next: "abcdefgh", confirm: "abcdefgh" }).ok).toBe(false);
    expect(parsePasswordChange({ current: "vieja123", next: "corta", confirm: "corta" }).ok).toBe(false);
    expect(parsePasswordChange({ current: "vieja123", next: "nueva1234", confirm: "nueva12345" }).ok).toBe(false);
    expect(parsePasswordChange({ current: "igual1234", next: "igual1234", confirm: "igual1234" }).ok).toBe(false);
    expect(parsePasswordChange({ current: "vieja123", next: "nueva1234", confirm: "nueva1234" })).toEqual({
      ok: true,
      value: { current: "vieja123", next: "nueva1234" },
    });
  });
  it("una nueva: no solo espacios ni mas de 72", () => {
    expect(parseNewPassword("        ", "        ").ok).toBe(false);
    expect(parseNewPassword("a".repeat(73), "a".repeat(73)).ok).toBe(false);
    expect(parseNewPassword("a".repeat(72), "a".repeat(72)).ok).toBe(true);
  });
});

describe("parseAvatarDataUrl", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  it("acepta un PNG por sus bytes", () => {
    const result = parseAvatarDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    expect(result.ok && result.ext).toBe("png");
  });
  it("rechaza algo que dice ser imagen y no lo es", () => {
    const fake = Buffer.from("<svg onload=alert(1)></svg>....").toString("base64");
    expect(parseAvatarDataUrl(`data:image/png;base64,${fake}`).ok).toBe(false);
  });
  it("rechaza lo que no es un data URL", () => {
    expect(parseAvatarDataUrl("https://example.com/a.png").ok).toBe(false);
    expect(parseAvatarDataUrl(null).ok).toBe(false);
  });
});

describe("rutas de la foto", () => {
  it("siempre en la carpeta de la persona", () => {
    expect(userAvatarPath("u1", "x", "jpg")).toBe("u1/x.jpg");
    expect(isOwnAvatarPath("u1", "u1/x.jpg")).toBe(true);
    expect(isOwnAvatarPath("u1", "u2/x.jpg")).toBe(false);
    expect(isOwnAvatarPath("u1", "u1/../u2/x.jpg")).toBe(false);
    expect(isOwnAvatarPath("u1", null)).toBe(false);
  });
});
