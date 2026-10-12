import { describe, it, expect } from "vitest";
import {
  brokenMappings,
  canIdentifyContact,
  DEFAULT_CONTACT_CONFIG,
  FIXED_TARGETS,
  linksContacts,
  NO_CONTACT_CONSEQUENCES,
  parseStoredContactConfig,
  SOCIAL_TARGET,
  suggestContactMap,
  targetAccepts,
  targetsFor,
  validateContactConfig,
  type CustomFieldDef,
} from "./contact-config";
import { SOCIAL_COLUMNS, SOCIAL_PLATFORMS } from "@/lib/contacts/social";
import { newField, type FormField } from "./fields";

const f = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({ ...newField(type, key, key), ...extra });
const customs: CustomFieldDef[] = [
  { id: "c-1", slug: "facturacion", name: "Facturación", type: "text" },
  { id: "c-2", slug: "edad", name: "Edad", type: "number" },
  { id: "c-3", slug: "acepta", name: "Acepta", type: "boolean" },
  { id: "c-4", slug: "empresa", name: "Empresa", type: "text" },
];

describe("targetAccepts", () => {
  it("email, teléfono y número van a lo que corresponde", () => {
    expect(targetAccepts(f("email", "e"), "contact.email")).toBe(true);
    expect(targetAccepts(f("number", "n"), "contact.email")).toBe(false);
    expect(targetAccepts(f("phone", "t"), "contact.phone")).toBe(true);
    expect(targetAccepts(f("phone", "t"), "contact.whatsapp_phone")).toBe(true);
    expect(targetAccepts(f("short_text", "s"), "contact.phone")).toBe(false);
    expect(targetAccepts(f("number", "n"), "contact.custom.edad", "number")).toBe(true);
    expect(targetAccepts(f("number", "n"), "contact.custom.empresa", "text")).toBe(true);
    expect(targetAccepts(f("number", "n"), "contact.custom.acepta", "boolean")).toBe(false);
  });

  it("el consentimiento solo va a un booleano; la selección múltiple, a texto", () => {
    expect(targetAccepts(f("consent", "c"), "contact.custom.acepta", "boolean")).toBe(true);
    expect(targetAccepts(f("consent", "c"), "contact.custom.empresa", "text")).toBe(false);
    expect(targetAccepts(f("multi_select", "m"), "contact.custom.empresa", "text")).toBe(true);
  });

  it("selección única va a país solo si las opciones son códigos ISO-2", () => {
    expect(targetAccepts(f("single_select", "p", { options: ["CR", "MX"] }), "contact.country")).toBe(true);
    expect(targetAccepts(f("single_select", "p", { options: ["Costa Rica", "México"] }), "contact.country")).toBe(false);
  });

  it("un archivo no se mapea a nada", () => {
    expect(targetAccepts(f("file", "a"), "contact.email")).toBe(false);
    expect(targetAccepts(f("file", "a"), "contact.custom.empresa", "text")).toBe(false);
  });

  it("nombre y apellido van a texto corto", () => {
    expect(targetAccepts(f("short_text", "s"), "contact.first_name_part")).toBe(true);
    expect(targetAccepts(f("long_text", "s"), "contact.display_name")).toBe(false);
  });
});

describe("validateContactConfig", () => {
  const fields = [f("number", "cantidad"), f("email", "email"), f("short_text", "nombre")];

  it("un campo número mapeado a contact.email no se puede guardar", () => {
    const r = validateContactConfig({ ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "cantidad", target: "contact.email" }] }, fields, customs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/no se puede guardar/);
  });

  it("acepta un mapeo válido", () => {
    const r = validateContactConfig(
      { mode: "link_only", update: "overwrite", map: [{ fieldKey: "email", target: "contact.email" }, { fieldKey: "nombre", target: "contact.display_name" }] },
      fields,
      customs,
    );
    expect(r.ok).toBe(true);
  });

  it("dos campos al mismo destino, o un campo mapeado dos veces, fallan", () => {
    const twoToOne = validateContactConfig({ map: [{ fieldKey: "email", target: "contact.email" }, { fieldKey: "nombre", target: "contact.email" }] }, fields, customs);
    expect(twoToOne.ok).toBe(false);
    const twice = validateContactConfig({ map: [{ fieldKey: "nombre", target: "contact.display_name" }, { fieldKey: "nombre", target: "contact.first_name_part" }] }, fields, customs);
    expect(twice.ok).toBe(false);
  });

  it("un campo personalizado borrado NO bloquea (se marca y se ignora al enviar)", () => {
    const r = validateContactConfig({ map: [{ fieldKey: "nombre", target: "contact.custom.ya-no-existe" }] }, fields, customs);
    expect(r.ok).toBe(true);
    expect(brokenMappings({ ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "nombre", target: "contact.custom.ya-no-existe" }] }, fields, customs)).toEqual([{ fieldKey: "nombre", reason: "custom" }]);
  });

  it("un campo del formulario que ya no existe se marca y es un error al guardar", () => {
    const config = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "borrado", target: "contact.email" }] };
    expect(brokenMappings(config, fields, customs)).toEqual([{ fieldKey: "borrado", reason: "field" }]);
    expect(validateContactConfig(config, fields, customs).ok).toBe(false);
  });

  it("destino desconocido y valores por defecto", () => {
    expect(validateContactConfig({ map: [{ fieldKey: "nombre", target: "contact.apellido" }] }, fields, customs).ok).toBe(false);
    const empty = validateContactConfig({}, fields, customs);
    expect(empty.ok && empty.config).toEqual(DEFAULT_CONTACT_CONFIG);
  });
});

describe("sugerencias y avisos", () => {
  it("al crear, email y teléfono se mapean solos y 'nombre' al nombre completo", () => {
    expect(suggestContactMap([f("short_text", "nombre"), f("email", "mail"), f("phone", "whatsapp")])).toEqual([
      { fieldKey: "mail", target: "contact.email" },
      { fieldKey: "whatsapp", target: "contact.phone" },
      { fieldKey: "nombre", target: "contact.display_name" },
    ]);
    expect(suggestContactMap([f("long_text", "x")])).toEqual([]);
  });

  it("sin email ni teléfono mapeados, ninguna respuesta va a poder identificar un contacto", () => {
    const fields = [f("short_text", "nombre"), f("email", "email")];
    expect(canIdentifyContact({ ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "nombre", target: "contact.display_name" }] }, fields)).toBe(false);
    expect(canIdentifyContact({ ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "email", target: "contact.email" }] }, fields)).toBe(true);
  });

  it("targetsFor ofrece solo lo compatible, agrupado", () => {
    const options = targetsFor(f("email", "e"), customs);
    expect(options.find((o) => o.value === "contact.email")?.group).toBe("Contacto");
    expect(options.some((o) => o.value === "contact.phone")).toBe(false);
    expect(options.some((o) => o.value === "contact.custom.edad")).toBe(false);
  });
});

describe("redes sociales como destino (R5)", () => {
  const ig = f("social", "ig", { social: { platform: "instagram" } });
  const tt = f("social", "tt", { social: { platform: "tiktok" } });

  it("cada destino de red coincide con la columna real de contacts", () => {
    for (const p of SOCIAL_PLATFORMS) expect(SOCIAL_TARGET[p]).toBe(`contact.${SOCIAL_COLUMNS[p]}`);
    expect(Object.values(SOCIAL_TARGET).every((t) => FIXED_TARGETS.includes(t))).toBe(true);
  });

  it("un campo social solo va a la columna de SU red", () => {
    expect(targetAccepts(ig, "contact.instagram_username")).toBe(true);
    expect(targetAccepts(ig, "contact.tiktok_username")).toBe(false);
    expect(targetAccepts(ig, "contact.email")).toBe(false);
    expect(targetAccepts(tt, "contact.tiktok_username")).toBe(true);
  });

  it("un texto corto o un oculto también puede ir a una red", () => {
    expect(targetAccepts(f("short_text", "usuario"), "contact.instagram_username")).toBe(true);
    expect(targetAccepts(f("hidden", "h"), "contact.twitter_username")).toBe(true);
    expect(targetAccepts(f("long_text", "l"), "contact.instagram_username")).toBe(false);
  });

  it("targetsFor ofrece solo la red del campo social", () => {
    const values = targetsFor(ig, customs).map((t) => t.value);
    expect(values).toContain("contact.instagram_username");
    expect(values).not.toContain("contact.tiktok_username");
  });

  it("un mapeo de un campo social a otra red no se puede guardar", () => {
    const r = validateContactConfig({ map: [{ fieldKey: "ig", target: "contact.tiktok_username" }] }, [ig], customs);
    expect(r.ok).toBe(false);
  });

  it("un usuario de red alcanza para identificar al contacto; Facebook y YouTube no", () => {
    const withIg = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "ig", target: "contact.instagram_username" }] };
    expect(canIdentifyContact(withIg, [ig])).toBe(true);
    const fb = f("social", "fb", { social: { platform: "facebook" } });
    const withFb = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "fb", target: "contact.facebook_id" }] };
    expect(canIdentifyContact(withFb, [fb])).toBe(false);
  });

  it("la sugerencia inicial mapea el campo social a su red", () => {
    expect(suggestContactMap([ig])).toEqual([{ fieldKey: "ig", target: "contact.instagram_username" }]);
  });
});

describe("el interruptor de contactos: modo none (R3)", () => {
  const email = f("email", "email");

  it("none es un modo válido y se guarda tal cual", () => {
    const r = validateContactConfig({ mode: "none", update: "fill_empty", map: [{ fieldKey: "email", target: "contact.email" }] }, [email], customs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.mode).toBe("none");
  });

  it("apagar y volver a prender no borra el mapeo: el mapeo es independiente del modo", () => {
    const map = [{ fieldKey: "email", target: "contact.email" }];
    const off = validateContactConfig({ mode: "none", update: "overwrite", map }, [email], customs);
    expect(off.ok && off.config.map).toEqual(map);
    const on = validateContactConfig({ ...(off.ok ? off.config : {}), mode: "create_or_link" }, [email], customs);
    expect(on.ok && on.config.map).toEqual(map);
    expect(on.ok && on.config.update).toBe("overwrite");
  });

  it("linksContacts dice si el interruptor está prendido", () => {
    expect(linksContacts({ mode: "none" })).toBe(false);
    expect(linksContacts({ mode: "create_or_link" })).toBe(true);
    expect(linksContacts({ mode: "link_only" })).toBe(true);
  });

  it("una configuración vieja (sin none) se sigue leyendo", () => {
    expect(parseStoredContactConfig({ mode: "link_only", update: "fill_empty", map: [] }).mode).toBe("link_only");
    expect(parseStoredContactConfig({}).mode).toBe("create_or_link");
    expect(parseStoredContactConfig("basura").mode).toBe("create_or_link");
  });

  it("las consecuencias se pueden mostrar", () => {
    expect(NO_CONTACT_CONSEQUENCES.length).toBeGreaterThanOrEqual(4);
  });
});
