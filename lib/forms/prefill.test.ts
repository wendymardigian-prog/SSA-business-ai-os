import { describe, it, expect } from "vitest";
import { coercePrefillValue, hiddenValues, prefillFromParams } from "./prefill";
import { newField, type FormField } from "./fields";

const f = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({
  ...newField(type, key, key),
  ...extra,
});

describe("prefillFromParams", () => {
  const email = f("email", "email");
  const plan = f("single_select", "plan", { options: ["A", "B"] });

  it("?email=ana@x.com&plan=Otro prellena el email y NO el plan inválido", () => {
    const r = prefillFromParams([email, plan], { email: "ana@x.com", plan: "Otro" });
    expect(r.values).toEqual({ email: "ana@x.com" });
  });

  it("el primer parámetro declarado con valor gana", () => {
    const campo = f("email", "mail", { prefill: { params: ["correo", "email"], behavior: "editable" } });
    const r = prefillFromParams([campo], { email: "b@x.com", correo: "a@x.com" });
    expect(r.values.mail).toBe("a@x.com");
  });

  it("si el primer parámetro trae algo inválido se prueba con el siguiente", () => {
    const campo = f("email", "mail", { prefill: { params: ["correo", "email"], behavior: "editable" } });
    expect(prefillFromParams([campo], { correo: "no-es-mail", email: "b@x.com" }).values.mail).toBe("b@x.com");
  });

  it("behavior hidden: si vino lleno no se muestra; si no vino, se muestra normal", () => {
    const campo = f("short_text", "ref", { prefill: { params: ["ref"], behavior: "hidden" } });
    expect(prefillFromParams([campo], { ref: "abc" }).hiddenByPrefill.has("ref")).toBe(true);
    expect(prefillFromParams([campo], {}).hiddenByPrefill.has("ref")).toBe(false);
  });

  it("behavior locked", () => {
    const campo = f("short_text", "plan2", { prefill: { params: ["plan"], behavior: "locked" } });
    const r = prefillFromParams([campo], { plan: "pro" });
    expect(r.locked.has("plan2")).toBe(true);
  });

  it("un hidden con valor inválido por URL se ignora y el campo se muestra vacío", () => {
    const campo = f("email", "mail", { prefill: { params: ["mail"], behavior: "hidden" } });
    const r = prefillFromParams([campo], { mail: "no-es-mail" });
    expect(r.values).toEqual({});
    expect(r.hiddenByPrefill.size).toBe(0);
  });

  it("número fuera de rango queda vacío", () => {
    const campo = f("number", "cantidad", { max: 10 });
    expect(prefillFromParams([campo], { cantidad: "50" }).values).toEqual({});
    expect(prefillFromParams([campo], { cantidad: "7" }).values).toEqual({ cantidad: 7 });
  });

  it("lo explícito gana sobre la URL", () => {
    const campo = f("single_select", "plan", { options: ["pro", "basic"] });
    const r = prefillFromParams([campo], { plan: "basic" }, { explicit: { plan: "pro" } });
    expect(r.values.plan).toBe("pro");
  });

  it("nunca prellena consentimiento ni archivo", () => {
    const r = prefillFromParams([f("consent", "ok"), f("file", "adj")], { ok: "true", adj: "x.pdf" });
    expect(r.values).toEqual({});
  });

  it("no distingue mayúsculas en el nombre del parámetro", () => {
    expect(prefillFromParams([email], { EMAIL: "ana@x.com" }).values.email).toBe("ana@x.com");
  });
});

describe("coercePrefillValue", () => {
  it("selección: devuelve la opción con sus mayúsculas originales", () => {
    expect(coercePrefillValue(f("single_select", "s", { options: ["Más de 10k", "Menos"] }), "más de 10K")).toBe("Más de 10k");
  });

  it("múltiple separada por coma; un valor inválido la invalida entera", () => {
    const campo = f("multi_select", "m", { options: ["A", "B", "C"] });
    expect(coercePrefillValue(campo, "a, c")).toEqual(["A", "C"]);
    expect(coercePrefillValue(campo, "a,zzz")).toBeNull();
  });

  it("fecha ISO real, NPS y estrellas enteros", () => {
    expect(coercePrefillValue(f("date", "d"), "2026-10-10")).toBe("2026-10-10");
    expect(coercePrefillValue(f("date", "d"), "2026-02-31")).toBeNull();
    expect(coercePrefillValue(f("date", "d"), "10/10/2026")).toBeNull();
    expect(coercePrefillValue(f("nps", "n"), "10")).toBe(10);
    expect(coercePrefillValue(f("nps", "n"), "11")).toBeNull();
    expect(coercePrefillValue(f("nps", "n"), "7.5")).toBeNull();
    expect(coercePrefillValue(f("rating", "r"), "0")).toBeNull();
    expect(coercePrefillValue(f("rating", "r"), "5")).toBe(5);
  });

  it("teléfono normalizado a E.164, con país por defecto", () => {
    expect(coercePrefillValue(f("phone", "t"), "+506 8888-1234")).toBe("+50688881234");
    expect(coercePrefillValue(f("phone", "t"), "8888 1234", "CR")).toBe("+50688881234");
    expect(coercePrefillValue(f("phone", "t"), "abc")).toBeNull();
  });

  it("email se normaliza a minúsculas", () => {
    expect(coercePrefillValue(f("email", "e"), " ANA@X.com ")).toBe("ana@x.com");
  });
});

describe("hiddenValues", () => {
  const url = { ...f("hidden", "campana"), hidden: { source: "url_param" as const, param: "utm_campaign" } };
  const attr = { ...f("hidden", "origen"), hidden: { source: "attribution" as const, param: "utm_source" } };
  const fixed = { ...f("hidden", "canal"), hidden: { source: "fixed" as const, value: "octubre" } };

  it("toma de la URL y de la atribución, nunca el valor fijo", () => {
    const out = hiddenValues([url, attr, fixed], { utm_campaign: "oct" }, { utm_source: "meta" });
    expect(out).toEqual({ campana: "oct", origen: "meta" });
    expect(JSON.stringify(out)).not.toContain("octubre");
  });
});
