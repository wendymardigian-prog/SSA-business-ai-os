import { describe, expect, it } from "vitest";
import { CONTACT_FIELDS } from "@/lib/contacts/fields";
import { CONTACT_DATA_GROUPS, FIELDS_ELSEWHERE, contactFieldHref } from "./data-groups";

describe("CONTACT_DATA_GROUPS", () => {
  const inGroups = CONTACT_DATA_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

  it("todo lo que editaba el boton 'Editar' tiene lugar en la ficha, en exactamente un sitio", () => {
    for (const field of CONTACT_FIELDS) {
      const sites = (inGroups.includes(field.key) ? 1 : 0) + (field.key in FIELDS_ELSEWHERE ? 1 : 0);
      expect(sites, `${field.key} tiene que estar en exactamente un lugar`).toBe(1);
    }
  });

  it("no hay un campo repetido ni uno que no exista", () => {
    expect(new Set(inGroups).size).toBe(inGroups.length);
    const known = new Set(CONTACT_FIELDS.map((f) => f.key));
    for (const key of inGroups) expect(known.has(key)).toBe(true);
  });

  it("los tres que viven en otro lado son el nombre, la temperatura y el seguimiento", () => {
    expect(Object.keys(FIELDS_ELSEWHERE).sort()).toEqual(["display_name", "lead_temperature", "next_followup_date"]);
  });

  it("las etiquetas estan en castellano, con acento", () => {
    const labels = CONTACT_DATA_GROUPS.flatMap((g) => g.fields.map((f) => f.label));
    expect(labels).toContain("Teléfono");
    expect(labels).toContain("País");
  });
});

describe("contactFieldHref", () => {
  it("emails, telefonos y redes llevan a donde corresponde", () => {
    expect(contactFieldHref("email", "ana@x.com")).toBe("mailto:ana@x.com");
    expect(contactFieldHref("phone", "+54 9 11 2233 4455")).toBe("tel:+5491122334455");
    expect(contactFieldHref("whatsapp_phone", "+54 9 11 2233")).toBe("https://wa.me/549112233");
    expect(contactFieldHref("instagram_username", "ana.gomez")).toBe("https://instagram.com/ana.gomez");
    expect(contactFieldHref("tiktok_username", "ana")).toBe("https://www.tiktok.com/@ana");
    expect(contactFieldHref("twitter_username", "ana")).toBe("https://x.com/ana");
  });

  it("un perfil de LinkedIn solo es link si es una URL web (nunca javascript:)", () => {
    expect(contactFieldHref("linkedin_profile_url", "https://linkedin.com/in/ana")).toBe("https://linkedin.com/in/ana");
    expect(contactFieldHref("linkedin_profile_url", "javascript:alert(1)")).toBeNull();
  });

  it("un pais, un resumen o un valor vacio no son links", () => {
    expect(contactFieldHref("country", "Argentina")).toBeNull();
    expect(contactFieldHref("ai_conversation_summary", "interesado")).toBeNull();
    expect(contactFieldHref("email", "")).toBeNull();
    expect(contactFieldHref("email", null)).toBeNull();
  });
});
