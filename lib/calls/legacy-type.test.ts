import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { derivedCallType } from "./legacy-type";

const CATEGORIES = [
  { id: "ventas", system_key: "ventas" },
  { id: "cierre", system_key: "ventas.cierre" },
  { id: "propio", system_key: null },
  { id: "equipo", system_key: "equipo" },
  { id: "servicio", system_key: "servicio" },
];
const snapshot = (area_id: string, type_id: string | null = null) => ({ area_id, area_name: "A", type_id, type_name: type_id ? "T" : null });
const derive = (call: Parameters<typeof derivedCallType>[2], handlers: Record<string, unknown> = { "booking_categories:select": { data: CATEGORIES } }) =>
  derivedCallType(fakeDb(handlers as never).client, "ws1", call);

describe("derivedCallType", () => {
  it("una reunion de equipo se reconoce por su area, aunque la renombren", async () => {
    expect(await derive({ category_snapshot: snapshot("equipo") })).toBe("equipo");
  });
  it("un tipo del sistema da su clave, y uno propio toma la de su area", async () => {
    expect(await derive({ category_snapshot: snapshot("ventas", "cierre") })).toBe("cierre");
    expect(await derive({ category_snapshot: snapshot("ventas", "propio") })).toBe("cierre");
    expect(await derive({ category_snapshot: snapshot("servicio") })).toBe("cliente");
  });
  it("no show gana, sin mirar el area", async () => {
    expect(await derive({ category_snapshot: snapshot("ventas", "cierre"), no_show: true }, {})).toBe("no_show");
  });
  it("sin clasificar no tiene clave", async () => {
    expect(await derive({ category_snapshot: null })).toBeNull();
  });
  it("si no puede leer las areas lanza: nunca hace pasar una reunion de equipo por otra cosa", async () => {
    await expect(derive({ category_snapshot: snapshot("equipo") }, { "booking_categories:select": { error: { message: "boom" } } })).rejects.toThrow("boom");
  });
});
