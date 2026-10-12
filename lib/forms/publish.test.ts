import { describe, it, expect } from "vitest";
import { checkPublishable, contactWarning, CONTACT_WARNING, hasUnpublishedChanges, stableStringify } from "./publish";
import { DEFAULT_CONTACT_CONFIG } from "./contact-config";
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

describe("contactWarning (R4)", () => {
  const email = newField("email", "email");
  const withEmail = { ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "email", target: "contact.email" }] };

  it("publicar sin ningún identificador con el interruptor prendido avisa", () => {
    expect(contactWarning(DEFAULT_CONTACT_CONFIG, [email])).toBe(CONTACT_WARNING);
    expect(CONTACT_WARNING).toContain("no va a crear ni vincular contactos");
  });

  it("con un email, un teléfono o un usuario de red mapeado no avisa", () => {
    expect(contactWarning(withEmail, [email])).toBeNull();
    const ig = { ...newField("social", "ig"), social: { platform: "instagram" as const } };
    expect(contactWarning({ ...DEFAULT_CONTACT_CONFIG, map: [{ fieldKey: "ig", target: "contact.instagram_username" }] }, [ig])).toBeNull();
  });

  it("con el interruptor apagado no avisa: es a propósito", () => {
    expect(contactWarning({ ...DEFAULT_CONTACT_CONFIG, mode: "none" }, [email])).toBeNull();
  });

  it("un mapeo a un campo que ya no existe no cuenta", () => {
    expect(contactWarning(withEmail, [])).toBe(CONTACT_WARNING);
  });
});
