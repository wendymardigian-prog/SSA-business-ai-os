import { describe, it, expect } from "vitest";
import { checkPublishable, hasUnpublishedChanges, stableStringify } from "./publish";
import { newField } from "./fields";

const good = { fields: [newField("email", "email")] };

describe("checkPublishable", () => {
  it("publicar no pide ninguna configuración externa", () => {
    // Antes exigía Cloudflare Turnstile (docs/pendientes/turnstile-captcha.md).
    const r = checkPublishable({ type: "custom", slug: "aplicacion", definition: good });
    expect(r.ok).toBe(true);
  });

  it("slug inválido rechaza", () => {
    const r = checkPublishable({ type: "custom", slug: "AB", definition: good });
    expect(r.ok).toBe(false);
  });

  it("una definición inválida junta sus errores", () => {
    const r = checkPublishable({
      type: "custom",
      slug: "aplicacion",
      definition: { fields: [newField("email", "a"), newField("email", "a")] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((m) => m.includes("repetida"))).toBe(true);
  });

  it("lo válido pasa y devuelve la definición", () => {
    const r = checkPublishable({ type: "custom", slug: "aplicacion", definition: good });
    expect(r.ok).toBe(true);
  });

  it("corre las reglas propias de cada tipo", () => {
    const r = checkPublishable({
      type: "survey",
      slug: "como-vas",
      definition: good,
      extraChecks: [() => ["Falta el puntaje principal"]],
    });
    expect(r).toEqual({ ok: false, reasons: ["Falta el puntaje principal"] });
  });
});

describe("hasUnpublishedChanges", () => {
  it("sin versión vigente hay cambios", () => {
    expect(hasUnpublishedChanges(good, null)).toBe(true);
  });

  it("el orden de las claves no importa", () => {
    expect(hasUnpublishedChanges({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(false);
  });

  it("un cambio de etiqueta cuenta", () => {
    const changed = { fields: [{ ...good.fields[0], label: "Otro" }] };
    expect(hasUnpublishedChanges(changed, good)).toBe(true);
    expect(hasUnpublishedChanges(good, good)).toBe(false);
  });

  it("stableStringify ignora undefined", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
