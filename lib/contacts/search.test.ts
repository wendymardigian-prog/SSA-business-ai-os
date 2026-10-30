import { describe, it, expect } from "vitest";
import { contactSearchFilter, lidSearchPattern } from "./search";

describe("contactSearchFilter", () => {
  it("busca por nombre, emails, telefonos y los @ de Instagram, TikTok y X", () => {
    const f = contactSearchFilter("ana")!.split(",");
    expect(f).toEqual([
      "display_name.ilike.*ana*",
      "email.ilike.*ana*",
      "secondary_email.ilike.*ana*",
      "phone.ilike.*ana*",
      "whatsapp_phone.ilike.*ana*",
      "instagram_username.ilike.*ana*",
      "tiktok_username.ilike.*ana*",
      "twitter_username.ilike.*ana*",
    ]);
  });

  it("un @ adelante se ignora en los usuarios", () => {
    const f = contactSearchFilter("@marca")!;
    expect(f).toContain("instagram_username.ilike.*marca*");
    expect(f).not.toContain("instagram_username.ilike.*@marca*");
  });

  it("un telefono con espacios, guiones o + se busca tambien por sus digitos", () => {
    const f = contactSearchFilter("+54 9 11 2233-4455")!;
    expect(f).toContain("phone.ilike.*5491122334455*");
    expect(f).toContain("whatsapp_phone.ilike.*5491122334455*");
  });

  it("solo digitos no repite la misma condicion", () => {
    const f = contactSearchFilter("2233")!.split(",");
    expect(f.filter((c) => c === "phone.ilike.*2233*")).toHaveLength(1);
  });

  it("suma los contactos encontrados por su id de WhatsApp, y descarta lo que no es un id", () => {
    const id = "6f1c2a3b-1111-4222-8333-944455556666";
    expect(contactSearchFilter("98765", [id, "x),(display_name.eq.y"])).toContain(`id.in.(${id})`);
    expect(contactSearchFilter("98765", ["no-es-un-id"])).not.toContain("id.in");
  });

  it("sin nada que buscar, null; las comillas no pasan", () => {
    expect(contactSearchFilter("   ")).toBeNull();
    expect(contactSearchFilter('a"b')).toContain("display_name.ilike.*ab*");
  });
});

describe("lidSearchPattern", () => {
  it("un numero de 6 o mas digitos se busca como id de WhatsApp", () => {
    expect(lidSearchPattern("98765432")).toBe("%98765432%@lid");
    expect(lidSearchPattern("ID 9876 5432")).toBe("%98765432%@lid");
  });

  it("un nombre o un numero corto, no", () => {
    expect(lidSearchPattern("ana")).toBeNull();
    expect(lidSearchPattern("12345")).toBeNull();
  });
});
