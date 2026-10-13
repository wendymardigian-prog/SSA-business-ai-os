import { describe, it, expect } from "vitest";
import { defaultEodConfig, mergeEodConfig, parseStoredEodConfig, validateEodConfig } from "./config";

const U1 = "11111111-1111-4111-8111-111111111111";

describe("eod_config", () => {
  it("la configuración por defecto es válida y arranca en 7 días, uno por día y todo el equipo", () => {
    const config = defaultEodConfig("setter");
    expect(validateEodConfig(config).ok).toBe(true);
    expect(config).toMatchObject({ variant: "setter", roleLabel: "Setter", pastDays: 7, reportMode: "single", audience: { mode: "all" } });
  });

  it("un EOD general toma el nombre del rol que se le pasa", () => {
    expect(defaultEodConfig("general", "  Soporte ").roleLabel).toBe("Soporte");
  });

  it("pastDays va de 0 a 31", () => {
    expect(validateEodConfig({ ...defaultEodConfig("general"), pastDays: 0 }).ok).toBe(true);
    expect(validateEodConfig({ ...defaultEodConfig("general"), pastDays: 32 }).ok).toBe(false);
    expect(validateEodConfig({ ...defaultEodConfig("general"), pastDays: -1 }).ok).toBe(false);
  });

  it("personas o roles elegidos sin elegir a nadie no es válido", () => {
    const base = defaultEodConfig("setter");
    expect(validateEodConfig({ ...base, audience: { mode: "users", userIds: [], roleIds: [] } }).ok).toBe(false);
    expect(validateEodConfig({ ...base, audience: { mode: "roles", userIds: [], roleIds: [] } }).ok).toBe(false);
    expect(validateEodConfig({ ...base, audience: { mode: "users", userIds: [U1], roleIds: [] } }).ok).toBe(true);
  });

  it("la hora del recordatorio va como HH:MM", () => {
    expect(validateEodConfig({ ...defaultEodConfig("setter"), reminder: { enabled: true, time: "25:00" } }).ok).toBe(false);
    expect(validateEodConfig({ ...defaultEodConfig("setter"), reminder: { enabled: true, time: "18:30" } }).ok).toBe(true);
  });

  it("CUANDO se intenta cambiar la variante de un EOD existente, se rechaza", () => {
    const stored = defaultEodConfig("setter");
    const result = mergeEodConfig(stored, { ...stored, variant: "general" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/variante/);
  });

  it("sin variante en lo que llega, se conserva la guardada", () => {
    const stored = defaultEodConfig("setter");
    const { variant: _omit, ...rest } = stored;
    const result = mergeEodConfig(stored, { ...rest, pastDays: 3 });
    expect(result.ok && result.config.variant).toBe("setter");
    expect(result.ok && result.config.pastDays).toBe(3);
  });

  it("una configuración guardada rota se lee como null, sin lanzar", () => {
    expect(parseStoredEodConfig(null)).toBeNull();
    expect(parseStoredEodConfig({ variant: "otra" })).toBeNull();
  });
});
