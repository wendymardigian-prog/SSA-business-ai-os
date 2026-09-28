/**
 * Los once estados de agenda (F32) viven en dos lugares: la lista de
 * `booking-status.ts` y el CHECK de la migracion 00099. Este test lee el
 * archivo SQL y compara, para que agregar un estado en uno solo se note acá y
 * no en producción con un 23514.
 *
 * Tambien compara los grupos: el CASE de la columna calculada `status_group`
 * tiene que decir lo mismo que `groupOf()`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOKING_STATUS_KEYS, groupOf, STATUS_GROUPS } from "./booking-status";
import type { BookingStatus, StatusGroup } from "./types";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/00099_bookings.sql"), "utf8");

function checkStatuses(): string[] {
  const match = sql.match(/bookings_status_check CHECK \(status IN \(([\s\S]*?)\)\)/);
  if (!match) throw new Error("no encontré el CHECK de bookings.status en la 00099");
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** El CASE de la columna calculada, leído del SQL. */
function generatedGroups(): { pairs: Array<[string, string]>; fallback: string } {
  const match = sql.match(/status_group\s+text GENERATED ALWAYS AS \(\s*CASE([\s\S]*?)END\s*\) STORED/);
  if (!match) throw new Error("no encontré la columna calculada status_group en la 00099");
  const body = match[1];
  const pairs: Array<[string, string]> = [];
  for (const line of body.split("\n")) {
    const when = line.match(/WHEN status (?:IN \(([^)]*)\)|= '([a-z_]+)') THEN '([a-z_]+)'/);
    if (!when) continue;
    const group = when[3];
    const statuses = when[1] ? [...when[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [when[2]];
    for (const status of statuses) pairs.push([status, group]);
  }
  const fallback = body.match(/ELSE '([a-z_]+)'/)?.[1];
  if (!fallback) throw new Error("el CASE de status_group no tiene ELSE");
  return { pairs, fallback };
}

describe("los estados de agenda del codigo y de la base son los mismos", () => {
  it("la lista y el CHECK coinciden, en el mismo orden", () => {
    expect(checkStatuses()).toEqual(BOOKING_STATUS_KEYS);
  });

  it("son once", () => {
    expect(BOOKING_STATUS_KEYS).toHaveLength(11);
  });

  it("el CASE de status_group dice lo mismo que groupOf()", () => {
    const { pairs, fallback } = generatedGroups();
    const fromSql = new Map(pairs);
    for (const status of BOOKING_STATUS_KEYS) {
      const expected = groupOf(status);
      const actual = (fromSql.get(status) ?? fallback) as StatusGroup;
      expect(actual, `el grupo de "${status}"`).toBe(expected);
    }
  });

  it("los cuatro grupos del codigo aparecen en el CASE", () => {
    const { pairs, fallback } = generatedGroups();
    const groups = new Set([...pairs.map(([, g]) => g), fallback]);
    expect([...groups].sort()).toEqual([...STATUS_GROUPS].sort());
  });

  it("todo estado cancelado cae en el grupo cancelled", () => {
    const cancelled = BOOKING_STATUS_KEYS.filter((s) => s.startsWith("cancelled_"));
    expect(cancelled).toHaveLength(3);
    for (const status of cancelled) expect(groupOf(status as BookingStatus)).toBe("cancelled");
  });
});
