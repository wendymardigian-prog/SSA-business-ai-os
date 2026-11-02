import { describe, it, expect } from "vitest";
import { guideFields, submitEndpoint, submitSnippet, unsubscribeLinkEndpoint, unsubscribeLinkSnippet } from "./website-guide";
import { newField } from "@/lib/forms/fields";

describe("la guía de Tu sitio web", () => {
  it("lista las preguntas que manda la web (sin los ocultos fijos)", () => {
    const fixed = { ...newField("hidden", "campana", "Campaña"), hidden: { source: "fixed" as const, value: "x" } };
    const fields = [{ ...newField("email", "email", "Tu email"), required: true }, fixed, newField("consent", "acepto", "Acepto")];
    expect(guideFields(fields).map((f) => f.key)).toEqual(["email", "acepto"]);
  });

  it("arma las URL y los ejemplos con los datos del negocio", () => {
    expect(submitEndpoint("https://app.ejemplo.com", "registro")).toBe("https://app.ejemplo.com/api/public/forms/registro/submit");
    expect(unsubscribeLinkEndpoint("https://app.ejemplo.com", "mi-negocio-1a2b")).toBe("https://app.ejemplo.com/api/public/email/unsubscribe-link?workspace=mi-negocio-1a2b");
    const code = submitSnippet("https://app.ejemplo.com", { name: "Registro", slug: "registro", fields: [{ key: "email", label: "Email", type: "email", required: true }] });
    expect(code).toContain('"email": "persona@ejemplo.com"');
    expect(code).toContain('origin: "site"');
    expect(code).toContain("idempotency_key");
    expect(unsubscribeLinkSnippet("https://app.ejemplo.com", "mi-negocio-1a2b")).toContain("honeypot");
  });
});
