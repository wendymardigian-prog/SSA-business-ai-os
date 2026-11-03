import { describe, expect, it } from "vitest";
import {
  appendCards,
  columnOf,
  evaluateContactDrop,
  groupingRole,
  kanbanColumnClause,
  kanbanColumnDefs,
  moveCard,
  parseContactView,
  parseKanbanGrouping,
  toKanbanCard,
  visibleKanbanColumns,
  type KanbanCard,
  type KanbanColumn,
} from "./kanban";
import type { ContactStatus } from "./statuses";

const st = (key: string, archived = false): ContactStatus => ({ key, name: key.toUpperCase(), color: "#888", archived_at: archived ? "2026-10-01T00:00:00Z" : null });
const list = [st("nuevo"), st("viejo", true), st("calificado")];

const card = (id: string): KanbanCard => toKanbanCard({ id, display_name: id });
const col = (key: string, ids: string[], total = ids.length, archived = false): KanbanColumn => ({
  key, name: key, color: null, archived, cards: ids.map(card), total,
});

describe("la vista y la agrupación en la URL", () => {
  it("la tabla es la de siempre; lo inventado vuelve a lo de siempre", () => {
    expect(parseContactView("kanban")).toBe("kanban");
    expect(parseContactView(undefined)).toBe("tabla");
    expect(parseContactView("lista")).toBe("tabla");
    expect(parseKanbanGrouping("vendedor")).toBe("vendedor");
    expect(parseKanbanGrouping("temperatura")).toBe("setter");
    expect(groupingRole("vendedor")).toBe("closer");
    expect(groupingRole("setter")).toBe("setter");
  });
});

describe("las columnas", () => {
  it("«Sin estado» primero, los activos en su orden y los archivados al final", () => {
    expect(kanbanColumnDefs(list).map((c) => [c.key, c.archived])).toEqual([
      ["ninguno", false],
      ["nuevo", false],
      ["calificado", false],
      ["viejo", true],
    ]);
  });

  it("con un filtro por estados del mismo rol, solo esas columnas", () => {
    expect(kanbanColumnDefs(list, ["calificado", "ninguno"]).map((c) => c.key)).toEqual(["ninguno", "calificado"]);
  });

  it("un archivado solo se ve si todavía tiene contactos", () => {
    expect(visibleKanbanColumns([col("nuevo", []), col("viejo", [], 0, true)]).map((c) => c.key)).toEqual(["nuevo"]);
    expect(visibleKanbanColumns([col("viejo", ["a"], 1, true)]).map((c) => c.key)).toEqual(["viejo"]);
  });

  it("cada columna filtra por la columna de su rol", () => {
    expect(kanbanColumnClause("setter", "nuevo")).toEqual({ op: "eq", column: "setter_status", value: "nuevo" });
    expect(kanbanColumnClause("closer", "ninguno")).toEqual({ op: "is_null", column: "closer_status" });
  });
});

describe("soltar una tarjeta", () => {
  const target = { key: "calificado", name: "Calificado", color: null, archived: false };
  it("en otra columna se mueve; en la misma no pasa nada", () => {
    expect(evaluateContactDrop("nuevo", target, true)).toEqual({ kind: "move" });
    expect(evaluateContactDrop("calificado", target, true)).toEqual({ kind: "noop" });
  });
  it("sin permiso o en un archivado se dice por qué", () => {
    expect(evaluateContactDrop("nuevo", target, false)).toMatchObject({ kind: "blocked" });
    const verdict = evaluateContactDrop("nuevo", { ...target, archived: true, name: "Viejo (archivado)" }, true);
    expect(verdict.kind).toBe("blocked");
    expect(verdict.kind === "blocked" && verdict.reason).toContain("archivado");
  });
});

describe("mover y cargar más en pantalla", () => {
  it("la tarjeta sale de su columna, entra arriba de la otra y los totales se corrigen", () => {
    const before = [col("nuevo", ["a", "b"], 30), col("calificado", ["c"], 5)];
    const after = moveCard(before, "b", "calificado");
    expect(after[0].cards.map((c) => c.id)).toEqual(["a"]);
    expect(after[0].total).toBe(29);
    expect(after[1].cards.map((c) => c.id)).toEqual(["b", "c"]);
    expect(after[1].total).toBe(6);
    expect(before[0].cards).toHaveLength(2);
    expect(columnOf(after, "b")).toBe("calificado");
  });

  it("mover a una columna que no está, o a la misma, no cambia nada", () => {
    const before = [col("nuevo", ["a"])];
    expect(moveCard(before, "a", "nuevo")).toEqual(before);
    expect(moveCard(before, "a", "no-existe")).toEqual(before);
    expect(moveCard(before, "zz", "nuevo")).toEqual(before);
  });

  it("«Cargar más» no repite las tarjetas que ya estaban", () => {
    const after = appendCards([col("nuevo", ["a", "b"], 4)], "nuevo", [card("b"), card("c")]);
    expect(after[0].cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("la tarjeta", () => {
  it("toma solo lo que conoce", () => {
    expect(toKanbanCard({ id: "x", display_name: "", lead_temperature: "tibio", is_known: 1, setter_id: "s" })).toMatchObject({
      id: "x", displayName: null, temperature: null, isKnown: true, setterId: "s", vendedorId: null,
    });
  });
});
