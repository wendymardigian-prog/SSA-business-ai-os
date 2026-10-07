import { describe, expect, it } from "vitest";
import { RESERVED_USERNAMES, suggestUsername, usernameChangeNeedsConfirmation, validateUsername } from "./profile";

describe("usuario del perfil (F3)", () => {
  it("acepta minusculas, numeros y guiones entre 3 y 40", () => {
    expect(validateUsername("ana")).toEqual({ ok: true, username: "ana" });
    expect(validateUsername("  Ana-M2 ")).toEqual({ ok: true, username: "ana-m2" });
  });

  it.each([
    ["ab", "too_short"],
    ["a".repeat(41), "too_long"],
    ["ana_m", "invalid_chars"],
    ["-ana", "invalid_chars"],
    ["ana-", "invalid_chars"],
    ["ñandu", "invalid_chars"],
    ["admin", "reserved"],
    ["Agenda", "reserved"],
  ])("rechaza %s con %s", (value, error) => {
    const result = validateUsername(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(error);
    expect(!result.ok && result.message.length).toBeGreaterThan(10);
  });

  it("rechaza uno ya usado en el workspace, sin importar mayusculas", () => {
    const result = validateUsername("Ana", { taken: ["ana"] });
    expect(!result.ok && result.error).toBe("taken");
  });

  it("todas las reservadas se rechazan", () => {
    for (const r of RESERVED_USERNAMES) expect(validateUsername(r).ok).toBe(false);
  });
});

describe("sugerencia de usuario", () => {
  it("sale del nombre, sin acentos ni espacios", () => {
    expect(suggestUsername("Ana Pérez", "w@x.com")).toBe("ana-perez");
  });
  it("si no hay nombre, del email; si esta tomado, suma un numero", () => {
    expect(suggestUsername("", "ana.perez@ejemplo.com")).toBe("ana-perez");
    expect(suggestUsername("Ana", null, ["ana", "ana-2"])).toBe("ana-3");
  });
  it("nunca sugiere una reservada ni una de menos de 3", () => {
    expect(suggestUsername("Admin", null)).toBe("admin-1");
    expect(suggestUsername("Jo", null)).toBe("jo-agenda");
  });
});

describe("cambiar el usuario con eventos activos", () => {
  it("sin eventos activos, o con confirmacion, pasa", () => {
    expect(usernameChangeNeedsConfirmation({ currentUsername: "ana", nextUsername: "wen", activeEvents: 0 })).toEqual({ ok: true });
    expect(usernameChangeNeedsConfirmation({ currentUsername: "ana", nextUsername: "wen", activeEvents: 3, confirmBrokenLinks: true })).toEqual({ ok: true });
  });
  it("con eventos activos y sin confirmar, se rechaza diciendo cuantos links cambian", () => {
    const r = usernameChangeNeedsConfirmation({ currentUsername: "ana", nextUsername: "wen", activeEvents: 3 });
    expect(r).toMatchObject({ ok: false, needsConfirmation: true, links: 3 });
    expect(!r.ok && r.message).toContain("3 eventos");
  });
  it("el mismo usuario (aunque cambie de mayusculas) no pide nada", () => {
    expect(usernameChangeNeedsConfirmation({ currentUsername: "ana", nextUsername: "ANA", activeEvents: 5 })).toEqual({ ok: true });
  });
});
