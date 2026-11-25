import { describe, expect, it } from "vitest";
import { buildContactVariables, CONTACT_DB_KEYS, seedBuiltContactVariables, type ContactVariableSources } from "./contact-variables";
import { interpolateVariables } from "./interpolate";

const base: ContactVariableSources = {
  contact: {
    id: "c-1",
    display_name: "Ana Pérez",
    email: "ana@x.com",
    phone: "+5491100000000",
    whatsapp_phone: "+5491100000000",
    instagram_username: "anaperez",
    country: "AR",
    setter_id: "u-set",
    vendedor_id: "u-ven",
    setter_status: "agendado",
    closer_status: "ganado",
    last_status: "ganado",
    last_status_role: "closer",
    qualification_level: 4,
    lead_temperature: "hot",
  },
  tags: ["vip", "webinar"],
  customFields: [
    { slug: "presupuesto", type: "number", value: "5000" },
    { slug: "acepto", type: "boolean", value: "true" },
    { slug: "cumple", type: "date", value: "2026-11-06" },
  ],
  statusSettings: {
    setter: [{ key: "agendado", name: "Agenda pendiente", color: "#2563eb", archived_at: null }],
    closer: [{ key: "ganado", name: "Cerrado", color: "#16a34a", archived_at: "2026-10-01T00:00:00Z" }],
  },
  memberNames: { "u-set": "Laura", "u-ven": "Pablo" },
};

describe("buildContactVariables", () => {
  it("arma todo como texto, con los nombres que se ven en pantalla", () => {
    const { contact } = buildContactVariables(base);
    expect(contact).toMatchObject({
      id: "c-1",
      first_name: "Ana",
      whatsapp: "+5491100000000",
      instagram: "anaperez",
      tags: "vip, webinar",
      setter_name: "Laura",
      vendedor_name: "Pablo",
      setter_status: "Agenda pendiente",
      // Un estado archivado conserva su nombre, sin «(archivado)».
      vendedor_status: "Cerrado",
      last_status: "Cerrado",
      qualification_level: "4",
      temperature: "Caliente",
      custom: { presupuesto: "5000", acepto: "Sí", cumple: "06/11/2026" },
    });
  });

  it("sin equipo y sin estado: todo vacío, nunca null", () => {
    const { contact } = buildContactVariables({ contact: { id: "c-2", display_name: null, email: null, phone: null } });
    for (const key of CONTACT_DB_KEYS) {
      if (key === "id" || key === "custom") continue;
      expect(contact[key], key).toBe("");
    }
    expect(contact.custom).toEqual({});
  });

  it("un nombre de relleno no se usa para saludar", () => {
    const { contact } = buildContactVariables({ contact: { id: "c-3", display_name: "Contacto de WhatsApp", email: null, phone: null } });
    expect(contact.first_name).toBe("");
  });

  it("un estado que ya no existe en la lista queda vacío (no muestra la clave interna)", () => {
    const { contact } = buildContactVariables({ ...base, contact: { ...base.contact, setter_status: "borrado" } });
    expect(contact.setter_status).toBe("");
  });

  it("todas las claves que arma están en CONTACT_DB_KEYS", () => {
    expect(Object.keys(buildContactVariables(base).contact).sort()).toEqual([...CONTACT_DB_KEYS].sort());
  });
});

describe("seedBuiltContactVariables", () => {
  const built = buildContactVariables(base);

  it("al arrancar gana lo que trajo el disparador", () => {
    const out = seedBuiltContactVariables({ contact: { first_name: "Anita" } }, built, "existing-wins") as { contact: Record<string, unknown> };
    expect(out.contact.first_name).toBe("Anita");
    expect(out.contact.vendedor_name).toBe("Pablo");
  });

  it("al retomar ganan los datos de ahora y se conserva lo que dejó un paso", () => {
    const stale = { contact: { vendedor_name: "Viejo", extra_de_un_paso: "x" } };
    const out = seedBuiltContactVariables(stale, built, "fresh-wins") as { contact: Record<string, unknown> };
    expect(out.contact.vendedor_name).toBe("Pablo");
    expect(out.contact.extra_de_un_paso).toBe("x");
  });

  it("se pueden usar en un mensaje, con respaldo", () => {
    const vars = seedBuiltContactVariables({}, built, "existing-wins");
    expect(interpolateVariables("Hola {{contact.first_name}}, te atiende {{contact.vendedor_name}} ({{contact.custom.presupuesto}} USD)", vars)).toBe(
      "Hola Ana, te atiende Pablo (5000 USD)",
    );
    expect(interpolateVariables("{{contact.custom.no_existe|sin dato}}", vars)).toBe("sin dato");
    expect(interpolateVariables("{{contact.timezone|sin zona}}", vars)).toBe("sin zona");
  });
});
