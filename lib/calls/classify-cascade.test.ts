import { describe, expect, it } from "vitest";
import { categoryIdOf, needsAi, resolveCascade } from "./classify-cascade";

const snap = (area: string, type: string | null = null) => ({
  area_id: `a-${area}`, area_name: area, type_id: type ? `t-${type}` : null, type_name: type,
});

describe("resolveCascade", () => {
  it("sin nada: Sin clasificar", () => {
    expect(resolveCascade({})).toEqual({ snapshot: null, source: null });
  });

  it("la reunion vinculada le gana a todo lo demas", () => {
    const r = resolveCascade({ booking: snap("Servicio", "Onboarding"), rule: snap("Ventas", "Cierre"), connection: snap("Equipo"), ai: snap("Otros", "General") });
    expect(r).toEqual({ snapshot: snap("Servicio", "Onboarding"), source: "booking" });
  });

  it("sin reunion decide la regla, despues la conexion y por ultimo la IA", () => {
    expect(resolveCascade({ rule: snap("Equipo", "Uno a uno"), connection: snap("Servicio"), ai: snap("Otros", "General") }).source).toBe("rule");
    expect(resolveCascade({ connection: snap("Servicio"), ai: snap("Servicio", "Onboarding") }).source).toBe("connection");
    expect(resolveCascade({ ai: snap("Otros", "General") }).source).toBe("ai");
  });

  it("un paso que solo da el area deja que otro complete el tipo dentro de esa area", () => {
    const r = resolveCascade({ booking: snap("Servicio"), rule: snap("Servicio", "Onboarding") });
    expect(r).toEqual({ snapshot: snap("Servicio", "Onboarding"), source: "booking" });
  });

  it("nunca cambia el area: un tipo de otra area no completa nada", () => {
    const r = resolveCascade({ booking: snap("Servicio"), rule: snap("Ventas", "Cierre"), ai: snap("Ventas", "Seguimiento") });
    expect(r).toEqual({ snapshot: snap("Servicio"), source: "booking" });
  });

  it("la conexion da el area y la IA completa el tipo", () => {
    const r = resolveCascade({ connection: snap("Servicio"), ai: snap("Servicio", "Uno a uno") });
    expect(r).toEqual({ snapshot: snap("Servicio", "Uno a uno"), source: "connection" });
  });

  it("una vinculacion sin area no cuenta", () => {
    const empty = { area_id: null, area_name: null, type_id: null, type_name: null };
    expect(resolveCascade({ booking: empty, rule: snap("Equipo") }).source).toBe("rule");
  });
});

describe("needsAi y categoryIdOf", () => {
  const cat = (id: string, parent_id: string | null, archived_at: string | null = null) => ({ id, parent_id, name: id, color: null, position: 0, is_system: false, archived_at });
  const categories = [cat("a-Servicio", null), cat("t-Onboarding", "a-Servicio"), cat("a-Equipo", null), cat("a-Otros", null), cat("t-Vieja", "a-Otros", "2026-01-01T00:00:00Z")];

  it("hace falta IA si no hay area, o si el area tiene tipos para elegir", () => {
    expect(needsAi({ snapshot: null, source: null }, categories)).toBe(true);
    expect(needsAi({ snapshot: snap("Servicio"), source: "connection" }, categories)).toBe(true);
    expect(needsAi({ snapshot: snap("Servicio", "Onboarding"), source: "booking" }, categories)).toBe(false);
  });

  it("un area sin tipos activos ya esta completa: no se gasta IA", () => {
    expect(needsAi({ snapshot: snap("Equipo"), source: "rule" }, categories)).toBe(false);
    expect(needsAi({ snapshot: snap("Otros"), source: "rule" }, categories)).toBe(false);
  });

  it("la categoria es el tipo o, si no hay, el area", () => {
    expect(categoryIdOf(snap("Servicio", "Onboarding"))).toBe("t-Onboarding");
    expect(categoryIdOf(snap("Servicio"))).toBe("a-Servicio");
    expect(categoryIdOf(null)).toBeNull();
  });
});
