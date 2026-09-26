import { describe, it, expect } from "vitest";
import {
  defaultBookingFields,
  validateBookingFields,
  buildBookingSchema,
  identifierFromLabel,
  uniqueIdentifier,
  visibleFields,
  contactDataFromResponses,
  EMAIL_OR_PHONE_REQUIRED,
} from "./booking-fields";
import { normalizePhoneWithCountry, isE164, findPhoneCountry, PHONE_COUNTRIES } from "./phone-countries";
import type { BookingField } from "./types";

const base = defaultBookingFields();
const withVisibility = (id: string, visibility: BookingField["visibility"]) =>
  base.map((f) => (f.identifier === id ? { ...f, visibility } : f));

const pregunta = (partial: Partial<BookingField>): BookingField => ({
  id: "q1",
  type: "short_text",
  system: false,
  label: "Pregunta",
  visibility: "optional",
  identifier: "pregunta",
  ...partial,
});

describe("validateBookingFields (F20, guardar el formulario)", () => {
  it("acepta el formulario base", () => {
    expect(validateBookingFields(base).ok).toBe(true);
  });

  it("rechaza email y teléfono los dos ocultos u opcionales", () => {
    for (const [e, p] of [
      ["hidden", "hidden"],
      ["optional", "optional"],
      ["hidden", "optional"],
    ] as const) {
      const fields = withVisibility("email", e).map((f) => (f.identifier === "phone" ? { ...f, visibility: p } : f));
      const r = validateBookingFields(fields);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((x) => x.message === EMAIL_OR_PHONE_REQUIRED)).toBe(true);
    }
    // Teléfono obligatorio y email oculto sí se puede.
    expect(validateBookingFields(withVisibility("email", "hidden").map((f) => (f.identifier === "phone" ? { ...f, visibility: "required" as const } : f))).ok).toBe(true);
  });

  it("rechaza dos preguntas con el mismo identificador", () => {
    const r = validateBookingFields([...base, pregunta({ id: "a", identifier: "presupuesto" }), pregunta({ id: "b", identifier: "presupuesto" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/mismo identificador|identificador "presupuesto"/);
  });

  it("el nombre no puede dejar de ser obligatorio y los del sistema van primero", () => {
    expect(validateBookingFields(withVisibility("name", "optional")).ok).toBe(false);
    expect(validateBookingFields([pregunta({}), ...base]).ok).toBe(false);
    expect(validateBookingFields(base.slice(1)).ok).toBe(false); // falta name
  });

  it("selección necesita entre 2 y 50 opciones sin repetir", () => {
    expect(validateBookingFields([...base, pregunta({ type: "select" })]).ok).toBe(false);
    expect(validateBookingFields([...base, pregunta({ type: "select", options: ["Una"] })]).ok).toBe(false);
    expect(validateBookingFields([...base, pregunta({ type: "select", options: ["a", "A"] })]).ok).toBe(false);
    expect(validateBookingFields([...base, pregunta({ type: "multiselect", options: ["Instagram", "WhatsApp"] })]).ok).toBe(true);
    expect(validateBookingFields([...base, pregunta({ type: "select", options: Array.from({ length: 51 }, (_, i) => `o${i}`) })]).ok).toBe(false);
  });

  it("identificadores: solo minúsculas, números y guión bajo, empiezan con letra", () => {
    expect(validateBookingFields([...base, pregunta({ identifier: "1abc" })]).ok).toBe(false);
    expect(validateBookingFields([...base, pregunta({ identifier: "Presupuesto" })]).ok).toBe(false);
    expect(validateBookingFields([...base, pregunta({ identifier: "presupuesto_2" })]).ok).toBe(true);
  });
});

describe("identificadores desde la etiqueta", () => {
  it("se autogeneran y quedan únicos", () => {
    expect(identifierFromLabel("¿Cuál es tu presupuesto?")).toBe("cual_es_tu_presupuesto");
    expect(identifierFromLabel("2024 objetivos")).toBe("p_2024_objetivos");
    expect(identifierFromLabel("!!!")).toBe("pregunta");
    expect(uniqueIdentifier("presupuesto", ["presupuesto", "presupuesto_2"])).toBe("presupuesto_3");
  });
});

describe("buildBookingSchema (F20, respuestas del invitado)", () => {
  const fields: BookingField[] = [
    ...base,
    pregunta({ id: "c", identifier: "canales", type: "multiselect", visibility: "required", options: ["Instagram", "WhatsApp", "Email"] }),
    pregunta({ id: "n", identifier: "nivel", type: "select", options: ["Inicial", "Avanzado"] }),
    pregunta({ id: "h", identifier: "oculta", visibility: "hidden" }),
  ];
  const schema = buildBookingSchema(fields, { defaultCountry: "CR" });

  it("acepta una respuesta completa y normaliza el teléfono con el país", () => {
    const r = schema.safeParse({
      name: "  Ana  ",
      email: "ana@ejemplo.com",
      phone: { country: "CR", number: "8888-1234" },
      canales: ["Instagram", "Email"],
      nivel: "Inicial",
      extra: "se descarta",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ name: "Ana", email: "ana@ejemplo.com", phone: "+50688881234", canales: ["Instagram", "Email"], nivel: "Inicial" });
    }
  });

  it("sin email obligatorio, o con una opción que no existe, falla en ese campo", () => {
    const sinEmail = schema.safeParse({ name: "Ana", canales: ["Instagram"] });
    expect(sinEmail.success).toBe(false);
    if (!sinEmail.success) expect(sinEmail.error.issues.map((i) => i.path[0])).toContain("email");

    const opcionRara = schema.safeParse({ name: "Ana", email: "a@b.com", canales: ["TikTok"] });
    expect(opcionRara.success).toBe(false);
    if (!opcionRara.success) expect(opcionRara.error.issues.map((i) => i.path[0])).toEqual(["canales"]);

    const emailMalo = schema.safeParse({ name: "Ana", email: "no-es-email", canales: ["Instagram"] });
    expect(emailMalo.success).toBe(false);
  });

  it("el teléfono que no queda E.164 después de normalizar con el país se rechaza", () => {
    const r = schema.safeParse({ name: "Ana", email: "a@b.com", canales: ["Instagram"], phone: { country: "CR", number: "12" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["phone"]);
    expect(schema.safeParse({ name: "Ana", email: "a@b.com", canales: ["Instagram"], phone: { country: "XX", number: "88881234" } }).success).toBe(false);
  });

  it("un string sin prefijo usa el país por defecto; con prefijo se respeta", () => {
    const ok = schema.safeParse({ name: "Ana", email: "a@b.com", canales: ["Instagram"], phone: "8888 1234" });
    expect(ok.success && ok.data.phone).toBe("+50688881234");
    const ar = schema.safeParse({ name: "Ana", email: "a@b.com", canales: ["Instagram"], phone: "+54 9 11 2233-4455" });
    expect(ar.success && ar.data.phone).toBe("+5491122334455");
  });

  it("opcionales vacíos se leen como sin respuesta; multiselect acepta un solo valor; ocultos no se piden", () => {
    const r = schema.safeParse({ name: "Ana", email: "a@b.com", phone: "", canales: "WhatsApp", nivel: "", oculta: "x" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBeUndefined();
      expect(r.data.nivel).toBeUndefined();
      expect(r.data.canales).toEqual(["WhatsApp"]);
      expect("oculta" in r.data).toBe(false);
    }
    expect(visibleFields(fields).map((f) => f.identifier)).not.toContain("oculta");
  });

  it("multiselect obligatoria vacía falla", () => {
    expect(schema.safeParse({ name: "Ana", email: "a@b.com", canales: [] }).success).toBe(false);
  });

  it("contactDataFromResponses extrae lo del contacto", () => {
    expect(contactDataFromResponses({ name: "Ana", email: "a@b.com", canales: ["x"] })).toEqual({ name: "Ana", email: "a@b.com", phone: null });
  });
});

describe("países y prefijos", () => {
  it("normaliza con país, quita el cero inicial y valida E.164", () => {
    expect(normalizePhoneWithCountry({ country: "AR", number: "011 2233-4455" })).toBe("+541122334455");
    expect(normalizePhoneWithCountry({ country: "MX", number: "55 1234 5678" })).toBe("+525512345678");
    expect(normalizePhoneWithCountry("0034 600 000 000")).toBe("+34600000000");
    expect(normalizePhoneWithCountry({ country: null, number: "8888 1234" }, "CR")).toBe("+50688881234");
    expect(normalizePhoneWithCountry({ country: null, number: "8888 1234" }, null)).toBeNull();
    expect(normalizePhoneWithCountry("")).toBeNull();
    expect(normalizePhoneWithCountry({ country: "CR", number: "abc" })).toBeNull();
    expect(isE164("+50688881234")).toBe(true);
    expect(isE164("50688881234")).toBe(false);
  });

  it("la lista tiene Costa Rica por defecto y códigos únicos", () => {
    expect(findPhoneCountry("cr")?.dial).toBe("506");
    expect(findPhoneCountry("ZZ")).toBeNull();
    expect(new Set(PHONE_COUNTRIES.map((c) => c.code)).size).toBe(PHONE_COUNTRIES.length);
  });
});
