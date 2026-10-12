import { describe, it, expect } from "vitest";
import { validateDefinition } from "./definition-schema";
import { newField, type FormField } from "./fields";

const text = (key: string, extra: Partial<FormField> = {}): FormField => ({ ...newField("short_text", key, key), ...extra });
const errorsOf = (fields: FormField[]) => {
  const r = validateDefinition({ fields });
  return r.ok ? [] : r.errors;
};

describe("validateDefinition", () => {
  it("acepta una definición válida y vacía", () => {
    expect(validateDefinition({ fields: [] }).ok).toBe(true);
    expect(validateDefinition({ fields: [text("nombre"), newField("email", "email")] }).ok).toBe(true);
  });

  it("dos campos con la misma clave fallan nombrando la clave", () => {
    const errors = errorsOf([text("nombre"), text("nombre")]);
    expect(errors.some((e) => e.includes('"nombre"') && e.includes("repetida"))).toBe(true);
  });

  it("una clave inválida falla", () => {
    expect(errorsOf([text("Mala Clave")]).length).toBeGreaterThan(0);
  });

  it("una condición que mira un campo posterior falla", () => {
    const a = text("a", {
      visibility: { rootConjunction: "and", conditions: [{ fieldKey: "b", operator: "is", value: "x" }], groups: [] },
    });
    const errors = errorsOf([a, text("b")]);
    expect(errors.some((e) => e.includes("solo puede mirar preguntas anteriores"))).toBe(true);
  });

  it("una condición sobre un campo anterior es válida", () => {
    const b = text("b", {
      visibility: { rootConjunction: "and", conditions: [{ fieldKey: "a", operator: "is", value: "x" }], groups: [] },
    });
    expect(errorsOf([text("a"), b])).toEqual([]);
  });

  it("archivo: 15 MB o un tipo fuera de la lista fallan", () => {
    const big = { ...newField("file", "adj"), file: { accept: ["application/pdf"], maxMb: 15, maxFiles: 1 } };
    expect(errorsOf([big]).some((e) => e.includes("10 MB"))).toBe(true);
    const exe = { ...newField("file", "adj"), file: { accept: ["application/x-msdownload"], maxMb: 5, maxFiles: 1 } };
    expect(errorsOf([exe]).some((e) => e.includes("no está permitido"))).toBe(true);
    const many = { ...newField("file", "adj"), file: { accept: ["application/pdf"], maxMb: 5, maxFiles: 4 } };
    expect(errorsOf([many]).length).toBeGreaterThan(0);
  });

  it("selección: opciones repetidas (sin importar mayúsculas), pocas o vacías fallan", () => {
    expect(errorsOf([{ ...newField("single_select", "s"), options: ["A", "a"] }]).some((e) => e.includes("repetidas"))).toBe(true);
    expect(errorsOf([{ ...newField("single_select", "s"), options: ["Solo una"] }]).some((e) => e.includes("al menos"))).toBe(true);
    expect(errorsOf([{ ...newField("single_select", "s"), options: ["A", " "] }]).some((e) => e.includes("vacía"))).toBe(true);
  });

  it("min mayor que max falla", () => {
    expect(errorsOf([{ ...newField("number", "n"), min: 10, max: 1 }]).length).toBeGreaterThan(0);
  });

  it("estrellas y NPS tienen rango fijo", () => {
    expect(errorsOf([{ ...newField("rating", "r"), max: 10 }]).length).toBeGreaterThan(0);
    expect(errorsOf([{ ...newField("nps", "n"), max: 5 }]).length).toBeGreaterThan(0);
    expect(errorsOf([newField("rating", "r"), newField("nps", "n")])).toEqual([]);
  });

  it("dos campos con el mismo parámetro de prellenado fallan", () => {
    const a = text("a", { prefill: { params: ["plan"], behavior: "editable" } });
    const b = text("b", { prefill: { params: ["Plan"], behavior: "locked" } });
    expect(errorsOf([a, b]).some((e) => e.includes('"plan"') || e.includes('"Plan"'))).toBe(true);
  });

  it("consentimiento y archivo no admiten prellenado", () => {
    const consent = { ...newField("consent", "ok"), prefill: { params: ["ok"], behavior: "editable" as const } };
    expect(errorsOf([consent]).some((e) => e.includes("no se puede prellenar"))).toBe(true);
    const file = { ...newField("file", "adj"), prefill: { params: ["adj"], behavior: "editable" as const } };
    expect(errorsOf([file]).some((e) => e.includes("no se puede prellenar"))).toBe(true);
  });

  it("un oculto necesita parámetro, dato de atribución válido o valor fijo", () => {
    const noParam = { ...newField("hidden", "h"), hidden: { source: "url_param" as const } };
    expect(errorsOf([noParam]).length).toBeGreaterThan(0);
    const badAttr = { ...newField("hidden", "h"), hidden: { source: "attribution" as const, param: "password" } };
    expect(errorsOf([badAttr]).length).toBeGreaterThan(0);
    const okAttr = { ...newField("hidden", "h"), hidden: { source: "attribution" as const, param: "utm_campaign" } };
    expect(errorsOf([okAttr])).toEqual([]);
    const noValue = { ...newField("hidden", "h"), hidden: { source: "fixed" as const } };
    expect(errorsOf([noValue]).length).toBeGreaterThan(0);
  });

  it("más de 60 campos falla", () => {
    const fields = Array.from({ length: 61 }, (_, i) => text(`c${i}`));
    expect(errorsOf(fields).some((e) => e.includes("60"))).toBe(true);
  });

  it("falta la etiqueta", () => {
    const r = validateDefinition({ fields: [{ ...text("a"), label: "" }] });
    expect(r.ok).toBe(false);
  });
});

import { validateDraftShape } from "./definition-schema";

describe("validateDraftShape (el borrador se guarda incompleto)", () => {
  it("acepta un campo sin etiqueta y con una sola opción", () => {
    const r = validateDraftShape({ fields: [{ id: "f1", key: "a", type: "single_select", label: "", required: false, options: ["Sola"] }] });
    expect(r.ok).toBe(true);
    // ...pero para publicar no alcanza.
    expect(validateDefinition({ fields: [{ id: "f1", key: "a", type: "single_select", label: "", required: false, options: ["Sola"] }] }).ok).toBe(false);
  });

  it("rechaza lo que no tiene forma de definición", () => {
    expect(validateDraftShape(null).ok).toBe(false);
    expect(validateDraftShape({ fields: "no" }).ok).toBe(false);
    expect(validateDraftShape({ fields: [{ id: "f1", key: "a", type: "tipo-inventado", label: "x" }] }).ok).toBe(false);
  });
});

describe("validateDefinition: usuario de red social (R5)", () => {
  it("un campo social lleva su red", () => {
    expect(errorsOf([newField("social", "ig", "Instagram")])).toEqual([]);
    const sinRed = { ...newField("social", "ig", "Instagram"), social: undefined };
    expect(errorsOf([sinRed as FormField]).some((e) => e.includes("de qué red"))).toBe(true);
  });

  it("una red que no existe no pasa la forma", () => {
    const mala = { ...newField("social", "ig", "Instagram"), social: { platform: "myspace" } };
    expect(validateDefinition({ fields: [mala] }).ok).toBe(false);
  });

  it("solo un campo social lleva red", () => {
    const raro = { ...text("nombre"), social: { platform: "instagram" as const } };
    expect(errorsOf([raro]).some((e) => e.includes("solo un campo de usuario"))).toBe(true);
  });

  it("su etiqueta por defecto sale de la red", () => {
    expect(newField("social", "ig").label).toBe("Tu usuario de Instagram");
  });
});
