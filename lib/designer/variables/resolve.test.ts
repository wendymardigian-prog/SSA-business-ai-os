import { describe, expect, it } from "vitest";
import cases from "./missing.cases.json";
import { isMissingDataError, isMissingPolicy, MISSING_POLICIES, MISSING_POLICY_LABELS, missingMessage, resolveValues, type ResolveSubject, type ResolveTemplate } from "./resolve";

type Case = {
  name: string;
  template?: Partial<ResolveTemplate>;
  subject?: Partial<Omit<ResolveSubject, "now">>;
  overrides?: Record<string, string>;
  policy: "fail" | "template_default" | "empty";
  expect: { ok: boolean; missing?: string[]; missingLabels?: string[]; values?: Record<string, string>; sources?: Record<string, string> };
};

const baseTemplate = cases.template as unknown as ResolveTemplate;
const baseSubject = cases.subject as unknown as ResolveSubject & { now: string };

describe("resolveValues: los casos de las tres políticas (F49, F55)", () => {
  for (const c of cases.cases as unknown as Case[]) {
    it(c.name, () => {
      const template = { ...baseTemplate, ...c.template } as ResolveTemplate;
      const subject = { ...baseSubject, ...c.subject, now: new Date(baseSubject.now) } as ResolveSubject;
      const out = resolveValues(template, subject, c.overrides ?? {}, c.policy);
      expect(out.ok).toBe(c.expect.ok);
      if (c.expect.missing) expect(out.missing.map((m) => m.key)).toEqual(c.expect.missing);
      if (c.expect.missingLabels) expect(out.missing.map((m) => m.label)).toEqual(c.expect.missingLabels);
      for (const [key, value] of Object.entries(c.expect.values ?? {})) expect(out.values[key], `valor de ${key}`).toBe(value);
      for (const [key, source] of Object.entries(c.expect.sources ?? {})) expect(out.sources[key], `origen de ${key}`).toBe(source);
    });
  }

  it("hay casos para las tres políticas", () => {
    const used = new Set((cases.cases as unknown as Case[]).map((c) => c.policy));
    expect([...used].sort()).toEqual([...MISSING_POLICIES].sort());
  });
});

describe("el resto del contrato de resolveValues", () => {
  const now = new Date("2026-11-08T02:00:00Z");
  const template: ResolveTemplate = { docKeys: ["nombre"], customVars: [{ key: "nombre", label: "Nombre", sample: "Ana", default: null }], dateFormat: "long", verify: false, docType: null, docTypeLabel: null };

  it("la política por defecto es «No generar y avisarme»", () => {
    expect(resolveValues(template, { now, timeZone: "UTC" }).ok).toBe(false);
  });

  it("devuelve siempre las variables de siempre, aunque el documento no las use (el email las necesita)", () => {
    const out = resolveValues(template, { now, timeZone: "UTC", contact: { display_name: "Lucía Ferreyra", email: "lucia@ejemplo.com" }, workspaceName: "Academia Ejemplo" }, { nombre: "Lu" });
    expect(out.values).toMatchObject({ nombre: "Lu", "contact.first_name": "Lucía", "contact.display_name": "Lucía Ferreyra", "contact.email": "lucia@ejemplo.com", "contact.phone": "", "workspace.name": "Academia Ejemplo" });
  });

  it("no lee el reloj ni la zona de la máquina: la misma fecha da lo mismo hoy y mañana", () => {
    const a = resolveValues(template, { now, timeZone: "Pacific/Auckland" }, { nombre: "x" });
    const b = resolveValues(template, { now, timeZone: "Pacific/Auckland" }, { nombre: "x" });
    expect(a.values["design.issued_on"]).toBe("8 de noviembre de 2026");
    expect(a).toEqual(b);
  });

  it("un valor del navegador que se pasa con espacios alrededor se guarda recortado", () => {
    expect(resolveValues(template, { now, timeZone: "UTC" }, { nombre: "  Ana  " }).values.nombre).toBe("Ana");
  });

  it("los textos de las políticas y las del motivo", () => {
    expect(MISSING_POLICY_LABELS).toEqual({ fail: "No generar y avisarme", template_default: "Usar el valor de la plantilla", empty: "Dejarlo vacío" });
    expect(missingMessage([{ label: "Nombre como lo quiere en el certificado" }])).toBe("Falta: Nombre como lo quiere en el certificado");
    expect(missingMessage([{ label: "A" }, { label: "B" }])).toBe("Falta: A, B");
    expect(isMissingDataError("Falta: Nombre")).toBe(true);
    expect(isMissingDataError("No se pudo armar el PDF")).toBe(false);
    expect(isMissingDataError(null)).toBe(false);
    expect(isMissingPolicy("fail") && isMissingPolicy("empty") && isMissingPolicy("template_default")).toBe(true);
    expect(isMissingPolicy("otra")).toBe(false);
  });
});
