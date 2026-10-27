/**
 * Los once estados de agenda viven en dos lugares: la lista de
 * `booking-status.ts` y el CHECK de `bookings.status` en las migraciones. Este test lee
 * la ultima definicion y compara, para que agregar un estado en uno solo se note acá y
 * no en producción con un 23514.
 *
 * Tambien compara los grupos: el CASE de la columna calculada `status_group`
 * tiene que decir lo mismo que `groupOf()`.
 */

import { describe, expect, it } from "vitest";
import { checkValues, lastDefinition } from "@/lib/test-utils/migrations";
import { BOOKING_STATUS_KEYS, groupOf, STATUS_GROUPS } from "./booking-status";
import type { BookingStatus, StatusGroup } from "./types";

function checkStatuses(): string[] {
  const found = checkValues("bookings_status_check");
  if (!found) throw new Error("no encontré el CHECK de bookings.status en las migraciones");
  return found.values;
}

/** El CASE de la columna calculada, leído del SQL. */
function generatedGroups(): { pairs: Array<[string, string]>; fallback: string } {
  const found = lastDefinition(/status_group\s+text\s+GENERATED ALWAYS AS \(\s*CASE([\s\S]*?)END\s*\)\s*STORED/i);
  if (!found) throw new Error("no encontré la columna calculada status_group en las migraciones");
  const body = found.match[1];
  const pairs: Array<[string, string]> = [];
  // Sirve escrito a mano (`WHEN status IN ('a', 'b') THEN 'x'`) o como lo devuelve la base
  // (`WHEN (status = ANY (ARRAY['a'::text, 'b'::text])) THEN 'x'::text`).
  for (const line of body.split("\n")) {
    const when = line.match(/WHEN([\s\S]*?)THEN\s+'([a-z_]+)'/);
    if (!when) continue;
    const group = when[2];
    const statuses = [...when[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
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
