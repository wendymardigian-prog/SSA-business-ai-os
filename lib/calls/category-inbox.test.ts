import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { loadCategoryProposals } from "./category-inbox";
import { EMPTY_CATEGORIES } from "./rubric";

describe("loadCategoryProposals", () => {
  const data = [
    { id: "a", recorded_at: "2026-10-02T10:00:00Z", objecion: { categoria: "falta de tiempo", propuesta: true }, dolor: null, deseo: null, razon_compra: null, razon_no_compra: null },
    { id: "b", recorded_at: "2026-10-03T10:00:00Z", objecion: { categoria: "Falta de tiempo", propuesta: true }, dolor: null, deseo: null, razon_compra: null, razon_no_compra: null },
  ];

  it("agrupa las propuestas de las llamadas analizadas", async () => {
    const db = fakeDb({ "calls:select": { data } });
    const out = await loadCategoryProposals(db.client, "ws1", EMPTY_CATEGORIES);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ group: "objeciones", calls: 2 });
  });

  it("solo lee llamadas analizadas, activas y del workspace, y NO escribe nada", async () => {
    const db = fakeDb({ "calls:select": { data } });
    await loadCategoryProposals(db.client, "ws1", EMPTY_CATEGORIES);
    expect(db.writes()).toHaveLength(0);
    const filters = db.calls[0].filters;
    expect(filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "eq", column: "workspace_id", value: "ws1" }),
      expect.objectContaining({ method: "eq", column: "analysis_status", value: "analyzed" }),
      expect.objectContaining({ method: "is", column: "archived_at" }),
    ]));
  });

  it("no pide la transcripcion ni el analisis entero", async () => {
    const db = fakeDb({ "calls:select": { data } });
    await loadCategoryProposals(db.client, "ws1", EMPTY_CATEGORIES);
    // El fake no guarda el texto de select; la garantia esta en el codigo: se revisa la fuente.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/calls/category-inbox.ts", "utf8");
    expect(src).not.toMatch(/select\([^)]*transcript/);
    expect(src).not.toMatch(/select\("\*"/);
  });

  it("si la lectura falla devuelve una lista vacia sin lanzar", async () => {
    const db = fakeDb({ "calls:select": { error: { message: "boom" } } });
    expect(await loadCategoryProposals(db.client, "ws1", EMPTY_CATEGORIES)).toEqual([]);
  });
});
