/**
 * "Horario normal" vive en dos lugares: defaultWeeklyHours() y la RPC
 * ensure_default_schedule. Este test los mantiene iguales.
 */
import { describe, expect, it } from "vitest";
import { defaultWeeklyHours } from "./availability-schema";
import { lastFunctionDefinition } from "@/lib/test-utils/migrations";

describe("Horario normal: codigo y migracion coinciden", () => {
  it("el jsonb de ensure_default_schedule es exactamente defaultWeeklyHours()", () => {
    const sql = lastFunctionDefinition("public.ensure_default_schedule")?.sql ?? "";
    const match = sql.match(/'(\{"1":\[.*?\]\})'::jsonb/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(defaultWeeklyHours());
  });
});
