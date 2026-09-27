/**
 * "Horario normal" vive en dos lugares: defaultWeeklyHours() y la RPC
 * ensure_default_schedule (00096). Este test los mantiene iguales.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultWeeklyHours } from "./availability-schema";

describe("Horario normal (F3): codigo y migracion coinciden", () => {
  it("el jsonb de la 00096 es exactamente defaultWeeklyHours()", () => {
    const sql = readFileSync("supabase/migrations/00096_availability.sql", "utf8");
    const match = sql.match(/'(\{"1":\[.*?\]\})'::jsonb/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(defaultWeeklyHours());
  });
});
