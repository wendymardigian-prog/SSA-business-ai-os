import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/testing/fake-db";
import { acceptTypeProposal, discardTypeProposal, groupTypeProposals, loadTypeProposals } from "./type-proposals";
import { DEFAULT_CLASSIFICATION, validTypeKeys } from "./task-settings";

const s = () => structuredClone(DEFAULT_CLASSIFICATION);
const rows = (...names: Array<string | null>) => names.map((n) => ({ call_type_proposed: n }));

describe("groupTypeProposals", () => {
  it("agrupa por nombre normalizado y cuenta", () => {
    const out = groupTypeProposals(rows("Webinar", "webinar", "Demo", null, "  "), s());
    expect(out).toEqual([{ key: "webinar", name: "Webinar", calls: 2 }, { key: "demo", name: "Demo", calls: 1 }]);
  });
  it("no propone lo que ya es un tipo ni lo descartado", () => {
    const set = { ...s(), discarded_types: ["Webinar"], custom_types: [{ clave: "demo", nombre: "Demo", descripcion: "", archivado: false }] };
    expect(groupTypeProposals(rows("Webinar", "Demo", "cierre", "Nuevo"), set).map((p) => p.key)).toEqual(["nuevo"]);
  });
  it("usa el nombre mas frecuente", () => {
    expect(groupTypeProposals(rows("Mesa redonda", "Mesa Redonda", "Mesa Redonda"), s())[0].name).toBe("Mesa Redonda");
  });
});

describe("decisiones", () => {
  it("aceptar crea un tipo propio valido y no muta el original", () => {
    const base = s();
    const next = acceptTypeProposal(base, "Mesa redonda", "Charla grupal");
    expect(validTypeKeys(next.custom_types)).toContain("mesa_redonda");
    expect(base.custom_types).toHaveLength(0);
  });
  it("descartar lo agrega una sola vez", () => {
    const once = discardTypeProposal(s(), "Ruido");
    expect(discardTypeProposal(once, "ruido").discarded_types).toEqual(["Ruido"]);
  });
});

describe("loadTypeProposals", () => {
  it("lee solo la columna del tipo propuesto y no escribe", async () => {
    const db = fakeDb({ "calls:select": { data: rows("Webinar", "Webinar") } });
    const out = await loadTypeProposals(db.client, "ws1", s());
    expect(out).toEqual([{ key: "webinar", name: "Webinar", calls: 2 }]);
    expect(db.writes()).toHaveLength(0);
  });
  it("si falla devuelve vacio", async () => {
    const db = fakeDb({ "calls:select": { error: { message: "x" } } });
    expect(await loadTypeProposals(db.client, "ws1", s())).toEqual([]);
  });
});
