import { describe, expect, it } from "vitest";
import { appendChunk, applyFetchedRows, mergeFreshFirstChunk, mergeVisibleUpdate, type LoadedList } from "./list-merge";
import { cursorOf } from "./list-cursor";

type Row = { id: string; last_message_at: string | null; created_at: string };

const at = (minute: number) => `2026-11-27T10:${String(minute).padStart(2, "0")}:00+00:00`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, minute: number | null): Row => ({ id: id(n), last_message_at: minute === null ? null : at(minute), created_at: at(0) });

/** Una lista cargada hasta la fila de la `last` (la mas vieja) con `hasMore`. */
function loaded(rows: Row[], hasMore: boolean): LoadedList<Row> {
  return { rows, cursor: rows.length ? cursorOf(rows[rows.length - 1]) : null, hasMore };
}
const ids = (l: { rows: Row[] }) => l.rows.map((r) => r.id);

describe("mergeFreshFirstChunk", () => {
  it("conserva lo que la persona ya bajo y pone arriba lo fresco", () => {
    // Habia bajado hasta el minuto 10; la primera tanda fresca llega hasta el 40 y trae un chat nuevo (59).
    const prev = loaded([row(1, 50), row(2, 40), row(3, 30), row(4, 20), row(5, 10)], true);
    const fresh = loaded([row(9, 59), row(1, 55), row(2, 40)], true);
    const merged = mergeFreshFirstChunk(prev, fresh);
    expect(ids(merged)).toEqual([id(9), id(1), id(2), id(3), id(4), id(5)]);
    expect(merged.cursor).toEqual(prev.cursor);
  });

  it("si no se habia bajado mas alla, queda lo fresco", () => {
    const prev = loaded([row(2, 45), row(1, 40)], true);
    const fresh = loaded([row(9, 59), row(2, 45), row(1, 40)], true);
    expect(mergeFreshFirstChunk(prev, fresh)).toEqual(fresh);
  });

  it("si lo fresco ya trae todo, no se agrega nada viejo (lo que salio de la lista no vuelve)", () => {
    const prev = loaded([row(1, 50), row(2, 40), row(3, 30)], true);
    const fresh = loaded([row(1, 50)], false);
    expect(mergeFreshFirstChunk(prev, fresh)).toEqual(fresh);
  });
});

describe("applyFetchedRows", () => {
  it("un chat nuevo entra arriba y cuenta como agregado", () => {
    const state = loaded([row(1, 50), row(2, 40)], true);
    const res = applyFetchedRows(state, [row(9, 59)], []);
    expect(ids(res.state)).toEqual([id(9), id(1), id(2)]);
    expect(res.added).toEqual([id(9)]);
    expect(res.removed).toEqual([]);
  });

  it("uno que ya no cumple el filtro sale", () => {
    const state = loaded([row(1, 50), row(2, 40)], true);
    const res = applyFetchedRows(state, [], [id(1)]);
    expect(ids(res.state)).toEqual([id(2)]);
    expect(res.removed).toEqual([id(1)]);
  });

  it("uno que cambio se reacomoda sin duplicarse", () => {
    const state = loaded([row(1, 50), row(2, 40)], true);
    const res = applyFetchedRows(state, [row(2, 58)], []);
    expect(ids(res.state)).toEqual([id(2), id(1)]);
    expect(res.added).toEqual([]);
  });

  it("uno mas viejo que lo cargado no entra: aparece al bajar", () => {
    const state = loaded([row(1, 50), row(2, 40)], true);
    const res = applyFetchedRows(state, [row(7, 5)], []);
    expect(ids(res.state)).toEqual([id(1), id(2)]);
    expect(res.added).toEqual([]);
  });

  it("sin nada mas para cargar, entra aunque sea viejo", () => {
    const state = loaded([row(1, 50), row(2, 40)], false);
    expect(ids(applyFetchedRows(state, [row(7, 5)], []).state)).toEqual([id(1), id(2), id(7)]);
  });
});

describe("appendChunk y mergeVisibleUpdate", () => {
  it("la tanda siguiente no repite un chat que entro en vivo", () => {
    const state = loaded([row(1, 50), row(2, 40)], true);
    const next = appendChunk(state, loaded([row(2, 40), row(3, 30)], false));
    expect(ids(next)).toEqual([id(1), id(2), id(3)]);
    expect(next.hasMore).toBe(false);
  });

  it("un mensaje nuevo sube la conversacion arriba (con la fecha como la manda Realtime)", () => {
    const rows = [row(1, 50), row(2, 40)];
    const next = mergeVisibleUpdate(rows, { id: id(2), last_message_at: "2026-11-27 10:59:00.5+00" });
    expect(next.map((r) => r.id)).toEqual([id(2), id(1)]);
  });
});
