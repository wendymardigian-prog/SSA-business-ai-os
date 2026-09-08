import { describe, it, expect } from "vitest";
import { validateContactField, validateContactInput } from "./fields";

describe("validateContactField", () => {
  it("normaliza el telefono al mismo formato que usa la deduplicacion", () => {
    for (const raw of ["+54 9 11 2233-4455", "005491122334455", "5491122334455"]) {
      expect(validateContactField("phone", raw)).toEqual({ ok: true, value: "+5491122334455" });
    }
  });

  it("rechaza un telefono que no sirve, con un mensaje que dice que hacer", () => {
    const result = validateContactField("phone", "1234");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("codigo de pais");
  });

  it("baja el email a minusculas y rechaza los invalidos", () => {
    expect(validateContactField("email", "  Juan@Example.COM ")).toEqual({
      ok: true,
      value: "juan@example.com",
    });
    expect(validateContactField("email", "juan@example").ok).toBe(false);
    expect(validateContactField("email", "juan example@x.com").ok).toBe(false);
  });

  it("saca la arroba y baja a minusculas los usernames", () => {
    expect(validateContactField("instagram_username", "@Juan.Perez")).toEqual({
      ok: true,
      value: "juan.perez",
    });
    expect(validateContactField("twitter_username", "con espacio").ok).toBe(false);
  });

  it("completa el esquema de una URL pegada a medias", () => {
    expect(validateContactField("linkedin_profile_url", "linkedin.com/in/juan")).toEqual({
      ok: true,
      value: "https://linkedin.com/in/juan",
    });
    expect(validateContactField("linkedin_profile_url", "no es una url").ok).toBe(false);
  });

  it("acepta solo las tres temperaturas del constraint", () => {
    expect(validateContactField("lead_temperature", "hot")).toEqual({ ok: true, value: "hot" });
    expect(validateContactField("lead_temperature", "tibio").ok).toBe(false);
  });

  it("un campo vacio queda en null: todos son opcionales", () => {
    expect(validateContactField("country", "   ")).toEqual({ ok: true, value: null });
    expect(validateContactField("phone", "")).toEqual({ ok: true, value: null });
    expect(validateContactField("email", null)).toEqual({ ok: true, value: null });
  });
});

describe("validateContactInput", () => {
  it("solo devuelve las claves que vinieron, para no borrar lo que no se toco", () => {
    const result = validateContactInput({ display_name: "Juan", email: "juan@example.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toEqual({ display_name: "Juan", email: "juan@example.com" });
      expect("phone" in result.patch).toBe(false);
    }
  });

  it("ignora las claves que no son campos del contacto", () => {
    const result = validateContactInput({ display_name: "Juan", workspace_id: "otro-workspace" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).toEqual({ display_name: "Juan" });
  });

  it("corta en el primer error", () => {
    const result = validateContactInput({ display_name: "Juan", email: "roto" });
    expect(result.ok).toBe(false);
  });
});
