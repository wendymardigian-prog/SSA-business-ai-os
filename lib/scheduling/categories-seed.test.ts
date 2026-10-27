import { describe, expect, it } from "vitest";
import { lastFunctionDefinition } from "@/lib/test-utils/migrations";
import { SYSTEM_AREAS, canArchive } from "@/lib/scheduling/categories";

/**
 * La lista de areas y tipos de sistema vive en dos lugares que tienen que decir lo mismo: el SQL que las precarga en
 * cada workspace (`seed_booking_categories_for_workspace`) y `SYSTEM_AREAS` del codigo (que usan los tests y la pantalla). Este test las compara.
 */

// La ultima definicion de la funcion que precarga las areas (sin comentarios).
const sql = lastFunctionDefinition("public.seed_booking_categories_for_workspace")?.sql ?? "";

function seedFromSql(): Array<{ name: string; color: string; types: string[] }> {
  const values = sql.slice(sql.indexOf("FROM (VALUES"), sql.indexOf(") AS x(name, color, types)"));
  return [...values.matchAll(/\('([^']+)',\s*'(#[0-9a-fA-F]{6})',\s*ARRAY\[([^\]]*)\]\)/g)].map((m) => ({
    name: m[1],
    color: m[2],
    types: [...m[3].matchAll(/'([^']+)'/g)].map((t) => t[1]),
  }));
}

describe("las areas de sistema de la agenda", () => {
  it("el SQL de la base y SYSTEM_AREAS son la misma lista, en el mismo orden", () => {
    expect(seedFromSql()).toEqual(SYSTEM_AREAS.map((a) => ({ name: a.name, color: a.color, types: [...a.types] })));
  });

  it("son cuatro: Ventas, Servicio, Equipo y Otros", () => {
    expect(SYSTEM_AREAS.map((a) => a.name)).toEqual(["Ventas", "Servicio", "Equipo", "Otros"]);
  });

  it("las entrevistas de candidatos son un tipo del area Equipo", () => {
    expect(SYSTEM_AREAS.find((a) => a.name === "Equipo")?.types).toContain("Entrevista");
    expect(SYSTEM_AREAS.find((a) => a.name === "Otros")?.types).not.toContain("Entrevista");
  });

  it("los colores salen de la paleta de las areas", async () => {
    const { AREA_COLORS } = await import("@/lib/scheduling/categories");
    for (const area of SYSTEM_AREAS) expect(AREA_COLORS as readonly string[]).toContain(area.color);
  });

  it("el nombre de un tipo no se repite dentro de su area (la base lo rechaza)", () => {
    for (const area of SYSTEM_AREAS) expect(new Set(area.types.map((t) => t.toLowerCase())).size).toBe(area.types.length);
  });

  it("ninguna de las cuatro se archiva, y las que crea el negocio si", () => {
    expect(canArchive({ is_system: true, parent_id: null }).ok).toBe(false);
    expect(canArchive({ is_system: false, parent_id: null }).ok).toBe(true);
    // Un tipo de sistema si se puede archivar (solo las areas estan protegidas).
    expect(canArchive({ is_system: true, parent_id: "x" }).ok).toBe(true);
  });

  it("la precarga no pisa lo que el negocio ya tenia: respeta una area con el mismo nombre y no le agrega tipos", () => {
    expect(sql).toMatch(/IF v_area IS NOT NULL THEN\s+CONTINUE;/);
    // Nunca reclasifica reuniones: ni una sola sentencia sobre las tablas de reservas o eventos.
    expect(sql).not.toMatch(/UPDATE\s+public\.(bookings|event_types)/i);
  });

  it("es idempotente: no hay INSERT sin ON CONFLICT ni sin comprobar la existencia", () => {
    const code = sql;
    const inserts = code.match(/INSERT INTO public\.booking_categories/g) ?? [];
    const guarded = code.match(/ON CONFLICT DO NOTHING/g) ?? [];
    expect(inserts.length).toBe(guarded.length);
  });
});
