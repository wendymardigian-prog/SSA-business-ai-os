import { describe, expect, it } from "vitest";
import { compareRows, cursorOf, isAfterCursor, keysetFilter, parseCursor, type CursorRow, type ListCursor } from "./list-cursor";

/**
 * Evaluador minimo del filtro `or` de PostgREST que arma `keysetFilter`, para
 * probar en memoria que "despues del cursor" dice lo mismo que el orden.
 */
function splitTop(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && ch === "(") depth++;
    if (!inQuote && ch === ")") depth--;
    if (!inQuote && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

function evalCondition(cond: string, row: CursorRow): boolean {
  if (cond.startsWith("and(")) return splitTop(cond.slice(4, -1)).every((c) => evalCondition(c, row));
  const [column, op, ...rest] = cond.split(".");
  const value = unquote(rest.join("."));
  const field = (row as unknown as Record<string, string | null>)[column];
  if (op === "is") return value === "null" ? field === null : false;
  if (field === null) return false; // en SQL, comparar con NULL no cumple
  if (column === "id") return op === "lt" ? field < value : field === value;
  const a = new Date(field).getTime();
  const b = new Date(value).getTime();
  return op === "lt" ? a < b : a === b;
}

function matches(filter: string, row: CursorRow): boolean {
  return splitTop(filter).some((c) => evalCondition(c, row));
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** Filas con muchos empates a proposito: pocas horas distintas y algunas sin mensaje. */
function randomRows(count: number, seed: number): CursorRow[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const hours = ["2026-11-27T10:00:00.123456+00:00", "2026-11-27T09:00:00+00:00", "2026-11-26T23:59:59.5+00:00"];
  return Array.from({ length: count }, (_, i) => ({
    id: uuid(Math.floor(rand() * 1_000_000) * 1000 + i),
    last_message_at: rand() < 0.15 ? null : hours[Math.floor(rand() * hours.length)],
    created_at: hours[Math.floor(rand() * hours.length)],
  }));
}

describe("cursor de la bandeja", () => {
  it("ordena como la base: sin mensaje al final, empates por creacion y despues por id", () => {
    const rows: CursorRow[] = [
      { id: uuid(1), last_message_at: null, created_at: "2026-11-27T12:00:00Z" },
      { id: uuid(2), last_message_at: "2026-11-27T10:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      { id: uuid(3), last_message_at: "2026-11-27T10:00:00Z", created_at: "2026-11-02T00:00:00Z" },
      { id: uuid(4), last_message_at: "2026-11-27T10:00:00Z", created_at: "2026-11-02T00:00:00Z" },
      { id: uuid(5), last_message_at: "2026-11-27T11:00:00Z", created_at: "2026-11-01T00:00:00Z" },
    ];
    expect([...rows].sort(compareRows).map((r) => r.id)).toEqual([uuid(5), uuid(4), uuid(3), uuid(2), uuid(1)]);
  });

  it("distingue microsegundos y entiende la fecha como la manda Realtime", () => {
    const a = { id: uuid(1), last_message_at: "2026-11-27T10:00:00.123456+00:00", created_at: "2026-11-01T00:00:00Z" };
    const b = { id: uuid(2), last_message_at: "2026-11-27 10:00:00.123457+00", created_at: "2026-11-01T00:00:00Z" };
    expect([a, b].sort(compareRows).map((r) => r.id)).toEqual([uuid(2), uuid(1)]);
  });

  it("recorrer de a tandas no repite ni saltea ninguna fila (200 filas con empates)", () => {
    for (const seed of [1, 7, 42, 99]) {
      const ordered = randomRows(200, seed).sort(compareRows);
      const seen: string[] = [];
      let cursor: ListCursor | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const pool: CursorRow[] = cursor ? ordered.filter((r) => matches(keysetFilter(cursor!), r)) : ordered;
        const chunk = pool.slice(0, 30);
        seen.push(...chunk.map((r) => r.id));
        if (pool.length <= 30) break;
        cursor = cursorOf(chunk[chunk.length - 1]);
      }
      expect(seen).toEqual(ordered.map((r) => r.id));
    }
  });

  it("el filtro coincide con isAfterCursor para cualquier par", () => {
    const rows = randomRows(80, 5);
    for (const c of rows) {
      const cursor = cursorOf(c);
      for (const r of rows) expect(matches(keysetFilter(cursor), r)).toBe(isAfterCursor(r, cursor));
    }
  });

  it("solo acepta fechas y un uuid: nada de texto libre en el filtro", () => {
    const ok = { lastMessageAt: "2026-11-27T10:00:00.123+00:00", createdAt: "2026-11-27T09:00:00Z", id: uuid(3) };
    expect(parseCursor(ok)).toEqual(ok);
    expect(parseCursor({ ...ok, lastMessageAt: null })).toEqual({ ...ok, lastMessageAt: null });
    expect(parseCursor({ ...ok, id: "x),status.eq.closed" })).toBeNull();
    expect(parseCursor({ ...ok, createdAt: "ayer" })).toBeNull();
    expect(parseCursor({ ...ok, lastMessageAt: '2026-11-27"),(' })).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });
});
