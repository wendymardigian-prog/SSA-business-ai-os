import { describe, it, expect } from "vitest";
import { applyContactMapping, canResolveContact } from "./contact-mapping";
import { DEFAULT_CONTACT_CONFIG, type CustomFieldDef } from "./contact-config";
import { newField, type FormField } from "./fields";

const f = (type: Parameters<typeof newField>[0], key: string): FormField => newField(type, key, key);
const customs: CustomFieldDef[] = [
  { id: "id-fact", slug: "facturacion", name: "Facturación", type: "text" },
  { id: "id-acepta", slug: "acepta", name: "Acepta", type: "boolean" },
];
const fields = [f("short_text", "nombre"), f("short_text", "apellido"), f("email", "email"), f("phone", "tel"), f("single_select", "pais"), f("single_select", "plan"), f("consent", "ok"), f("multi_select", "intereses")];
const cfg = (map: Array<[string, string]>) => ({ ...DEFAULT_CONTACT_CONFIG, map: map.map(([fieldKey, target]) => ({ fieldKey, target })) });

describe("applyContactMapping", () => {
  it("first_name_part y last_name_part dan display_name = 'Ana Pérez'", () => {
    const hint = applyContactMapping(fields, cfg([["nombre", "contact.first_name_part"], ["apellido", "contact.last_name_part"]]), { nombre: "Ana", apellido: "Pérez" }, customs);
    expect(hint.display_name).toBe("Ana Pérez");
  });

  it("si solo vino el nombre, queda el nombre; si hay display_name explícito, gana", () => {
    expect(applyContactMapping(fields, cfg([["nombre", "contact.first_name_part"], ["apellido", "contact.last_name_part"]]), { nombre: "Ana" }, customs).display_name).toBe("Ana");
    expect(applyContactMapping(fields, cfg([["nombre", "contact.display_name"], ["apellido", "contact.last_name_part"]]), { nombre: "Ana Pérez", apellido: "Otro" }, customs).display_name).toBe("Ana Pérez");
  });

  it("email en minúsculas, teléfonos y país en mayúsculas", () => {
    const hint = applyContactMapping(
      fields,
      cfg([["email", "contact.email"], ["tel", "contact.phone"], ["pais", "contact.country"]]),
      { email: "ANA@X.com", tel: "+50688881234", pais: "cr" },
      customs,
    );
    expect(hint).toMatchObject({ email: "ana@x.com", phone: "+50688881234", country: "CR" });
  });

  it("un país que no son dos letras se ignora", () => {
    expect(applyContactMapping(fields, cfg([["pais", "contact.country"]]), { pais: "Costa Rica" }, customs).country).toBeUndefined();
  });

  it("campos personalizados por id, con booleanos y listas en texto", () => {
    const hint = applyContactMapping(
      fields,
      cfg([["plan", "contact.custom.facturacion"], ["ok", "contact.custom.acepta"]]),
      { plan: "Más de 10k", ok: true },
      customs,
    );
    expect(hint.custom).toEqual({ "id-fact": "Más de 10k", "id-acepta": "true" });
    const multi = applyContactMapping(fields, cfg([["intereses", "contact.custom.facturacion"]]), { intereses: ["Ads", "Contenido"] }, customs);
    expect(multi.custom["id-fact"]).toBe("Ads, Contenido");
  });

  it("un campo personalizado borrado y un campo del formulario borrado se ignoran sin fallar", () => {
    const hint = applyContactMapping(fields, cfg([["plan", "contact.custom.ya-no-existe"], ["fantasma", "contact.email"]]), { plan: "A", fantasma: "x@y.com" }, customs);
    expect(hint).toEqual({ custom: {} });
  });

  it("lo vacío no se manda (nunca borra un dato con un vacío)", () => {
    const hint = applyContactMapping(fields, cfg([["email", "contact.email"], ["nombre", "contact.display_name"]]), { email: "", nombre: "  " }, customs);
    expect(hint).toEqual({ custom: {} });
  });
});

describe("canResolveContact", () => {
  it("hace falta email o teléfono", () => {
    expect(canResolveContact({ custom: {} })).toBe(false);
    expect(canResolveContact({ display_name: "Ana", custom: {} })).toBe(false);
    expect(canResolveContact({ email: "a@x.com", custom: {} })).toBe(true);
    expect(canResolveContact({ whatsapp_phone: "+5068", custom: {} })).toBe(true);
  });
});

describe("redes sociales en el mapeo (R5)", () => {
  const social = [f("social", "ig"), f("social", "li"), f("short_text", "usuario")].map((x) =>
    x.key === "ig" ? { ...x, social: { platform: "instagram" as const } } : x.key === "li" ? { ...x, social: { platform: "linkedin" as const } } : x,
  );

  it("el hint lleva los usuarios ya normalizados", () => {
    const hint = applyContactMapping(
      social,
      cfg([["ig", "contact.instagram_username"], ["li", "contact.linkedin_profile_url"]]),
      { ig: "@Ana.Perez", li: "linkedin.com/in/Ana-Perez/" },
      customs,
    );
    expect(hint.social).toEqual({ instagram: "ana.perez", linkedin: "https://www.linkedin.com/in/ana-perez" });
  });

  it("un texto que no es un usuario válido no se guarda en el contacto", () => {
    const hint = applyContactMapping(social, cfg([["usuario", "contact.tiktok_username"]]), { usuario: "esto no es un usuario" }, customs);
    expect(hint.social).toBeUndefined();
  });

  it("un texto corto con un usuario válido sí se guarda", () => {
    const hint = applyContactMapping(social, cfg([["usuario", "contact.tiktok_username"]]), { usuario: "@Ana" }, customs);
    expect(hint.social).toEqual({ tiktok: "ana" });
  });

  it("canResolveContact: un @ alcanza; Facebook o YouTube solos no", () => {
    expect(canResolveContact({ custom: {}, social: { instagram: "ana" } })).toBe(true);
    expect(canResolveContact({ custom: {}, social: { tiktok: "ana" } })).toBe(true);
    expect(canResolveContact({ custom: {}, social: { facebook: "ana", youtube: "UC1" } })).toBe(false);
    expect(canResolveContact({ custom: {} })).toBe(false);
  });
});
