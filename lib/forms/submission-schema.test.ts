import { describe, it, expect } from "vitest";
import { toLabeledAnswers, validateSubmission } from "./submission-schema";
import { newField, type FormField } from "./fields";

const f = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({
  ...newField(type, key, key),
  ...extra,
});

describe("validateSubmission: obligatorios y formatos", () => {
  it("falta un obligatorio visible", () => {
    const r = validateSubmission([f("short_text", "nombre", { required: true })], {});
    expect(r.ok).toBe(false);
    expect(r.errors.nombre).toBeDefined();
  });

  it("email y teléfono se normalizan", () => {
    const r = validateSubmission(
      [f("email", "email", { required: true }), f("phone", "tel")],
      { email: " ANA@X.com ", tel: "8888 1234" },
      { defaultCountry: "CR" },
    );
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ email: "ana@x.com", tel: "+50688881234" });
  });

  it("email y teléfono inválidos", () => {
    const r = validateSubmission([f("email", "email"), f("phone", "tel")], { email: "nope", tel: "abc" });
    expect(Object.keys(r.errors).sort()).toEqual(["email", "tel"]);
  });

  it("una opción que no existe falla", () => {
    const r = validateSubmission([f("single_select", "plan", { options: ["A", "B"] })], { plan: "Z" });
    expect(r.ok).toBe(false);
  });

  it("una opción válida se devuelve con sus mayúsculas originales", () => {
    const r = validateSubmission([f("single_select", "plan", { options: ["Más de 10k", "Menos"] })], { plan: "más de 10K" });
    expect(r.values.plan).toBe("Más de 10k");
  });

  it("múltiple: una opción inexistente invalida todo", () => {
    const field = f("multi_select", "m", { options: ["A", "B"] });
    expect(validateSubmission([field], { m: ["A", "Z"] }).ok).toBe(false);
    expect(validateSubmission([field], { m: ["a", "B", "A"] }).values.m).toEqual(["A", "B"]);
  });

  it("NPS: 11 y 7.5 fallan; 0 y 10 pasan; llega como texto", () => {
    const field = f("nps", "nps", { required: true });
    expect(validateSubmission([field], { nps: 11 }).ok).toBe(false);
    expect(validateSubmission([field], { nps: 7.5 }).ok).toBe(false);
    expect(validateSubmission([field], { nps: 0 }).values.nps).toBe(0);
    expect(validateSubmission([field], { nps: "10" }).values.nps).toBe(10);
  });

  it("estrellas de 1 a 5", () => {
    const field = f("rating", "r", { required: true });
    expect(validateSubmission([field], { r: 0 }).ok).toBe(false);
    expect(validateSubmission([field], { r: 6 }).ok).toBe(false);
    expect(validateSubmission([field], { r: 4 }).ok).toBe(true);
  });

  it("número con mínimo y máximo", () => {
    const field = f("number", "n", { min: 1, max: 10 });
    expect(validateSubmission([field], { n: 0 }).ok).toBe(false);
    expect(validateSubmission([field], { n: 11 }).ok).toBe(false);
    expect(validateSubmission([field], { n: "5" }).values.n).toBe(5);
    expect(validateSubmission([field], { n: "abc" }).ok).toBe(false);
  });

  it("fecha ISO real", () => {
    const field = f("date", "d");
    expect(validateSubmission([field], { d: "2026-10-10" }).ok).toBe(true);
    expect(validateSubmission([field], { d: "2026-02-31" }).ok).toBe(false);
  });

  it("consentimiento obligatorio = true", () => {
    const field = f("consent", "ok", { required: true });
    expect(validateSubmission([field], { ok: false }).ok).toBe(false);
    expect(validateSubmission([field], {}).ok).toBe(false);
    expect(validateSubmission([field], { ok: true }).ok).toBe(true);
    expect(validateSubmission([field], { ok: "true" }).ok).toBe(true);
  });

  it("archivo obligatorio sin archivos falla; con archivos pasa", () => {
    const field = f("file", "adj", { required: true });
    expect(validateSubmission([field], {}).ok).toBe(false);
    expect(validateSubmission([field], {}, { fileCounts: { adj: 1 } }).ok).toBe(true);
  });
});

describe("validateSubmission: lo que el navegador no dejaría mandar", () => {
  const fields: FormField[] = [
    f("single_select", "facturacion", { options: ["menos de 1k", "más de 10k"], required: true }),
    f("short_text", "presupuesto", {
      required: true,
      visibility: { rootConjunction: "and", conditions: [{ fieldKey: "facturacion", operator: "is", value: "más de 10k" }], groups: [] },
    }),
  ];

  it("un campo oculto por condición con valor NO se guarda", () => {
    const r = validateSubmission(fields, { facturacion: "menos de 1k", presupuesto: "colado" });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ facturacion: "menos de 1k" });
    expect(r.visible).toEqual(["facturacion"]);
  });

  it("un obligatorio oculto por condición NO se exige", () => {
    expect(validateSubmission(fields, { facturacion: "menos de 1k" }).ok).toBe(true);
  });

  it("si la condición se cumple el obligatorio sí se exige", () => {
    const r = validateSubmission(fields, { facturacion: "más de 10k" });
    expect(r.ok).toBe(false);
    expect(r.errors.presupuesto).toBeDefined();
  });

  it("las claves desconocidas se descartan", () => {
    const r = validateSubmission(fields, { facturacion: "más de 10k", presupuesto: "5k", admin: "true", __proto__x: "y" });
    expect(Object.keys(r.values).sort()).toEqual(["facturacion", "presupuesto"]);
  });

  it("encadenado: una condición sobre un campo oculto no se cumple con su valor colado", () => {
    const chain: FormField[] = [
      f("short_text", "a", {}),
      f("short_text", "b", {
        visibility: { rootConjunction: "and", conditions: [{ fieldKey: "a", operator: "is", value: "si" }], groups: [] },
      }),
      f("short_text", "c", {
        required: true,
        visibility: { rootConjunction: "and", conditions: [{ fieldKey: "b", operator: "is_not_empty", value: "" }], groups: [] },
      }),
    ];
    const r = validateSubmission(chain, { a: "no", b: "colado", c: "" });
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ a: "no" });
  });
});

describe("toLabeledAnswers", () => {
  it("guarda la etiqueta de la versión junto a cada valor", () => {
    const fields = [f("short_text", "nombre", { label: "Tu nombre" })];
    expect(toLabeledAnswers(fields, { nombre: "Ana", otro: "x" })).toEqual({
      nombre: { label: "Tu nombre", type: "short_text", value: "Ana" },
    });
  });
});

describe("validateSubmission: usuario de red social (R5)", () => {
  const ig = f("social", "instagram", { social: { platform: "instagram" } });

  it.each(["@Ana", "ana", "instagram.com/ana", "https://instagram.com/ana/?hl=es"])("%s se guarda como ana", (raw) => {
    const r = validateSubmission([ig], { instagram: raw });
    expect(r.ok).toBe(true);
    expect(r.values.instagram).toBe("ana");
  });

  it("un usuario con espacios es un error del campo", () => {
    const r = validateSubmission([ig], { instagram: "ana perez" });
    expect(r.errors.instagram).toBe("Ese usuario de Instagram no es válido");
  });

  it("obligatorio y vacío: falta; opcional y vacío: no pasa nada", () => {
    expect(validateSubmission([{ ...ig, required: true }], { instagram: " " }).errors.instagram).toBeDefined();
    expect(validateSubmission([ig], {}).ok).toBe(true);
  });

  it("LinkedIn guarda la URL del perfil", () => {
    const li = f("social", "linkedin", { social: { platform: "linkedin" } });
    expect(validateSubmission([li], { linkedin: "linkedin.com/in/Ana-Perez/" }).values.linkedin).toBe("https://www.linkedin.com/in/ana-perez");
  });
});
