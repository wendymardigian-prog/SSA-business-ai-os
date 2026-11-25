/**
 * Lo que usó y dejó cada paso (`flow_session_steps.input` / `.output`) tiene datos personales: desde la 00515 la sesión
 * del navegador lee la tabla por COLUMNAS, sin esas dos. Este test lee la migración y el código:
 * - el GRANT no incluye `input` ni `output`;
 * - el GRANT incluye todas las demás columnas de la tabla (si no, una columna nueva quedaría ilegible sin avisar);
 * - lo que pide la pantalla con la sesión (`lib/flows/runs-query.ts`) está todo en el GRANT.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = (name: string) => readFileSync(join(root, "supabase/migrations", name), "utf8");

function grantedColumns(): string[] {
  const sql = migration("00515_flow_step_audit.sql");
  const match = sql.match(/GRANT SELECT \(([^)]*)\)\s+ON public\.flow_session_steps TO authenticated/);
  if (!match) throw new Error("No encontré el GRANT por columnas de flow_session_steps en la 00515");
  return match[1].split(",").map((c) => c.trim()).filter(Boolean);
}

/** Las columnas de la tabla según las migraciones que la arman (00292, 00317 y 00515). */
function tableColumns(): string[] {
  const create = migration("00292_flow_run_history.sql").match(/CREATE TABLE IF NOT EXISTS public\.flow_session_steps \(([\s\S]*?)\n\);/);
  if (!create) throw new Error("No encontré la tabla en la 00292");
  const base = create[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"))
    .map((l) => l.split(/\s+/)[0]);
  const added = [...migration("00317_flow_step_metrics.sql").matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g), ...migration("00515_flow_step_audit.sql").matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)]
    .map((m) => m[1])
    .filter((c) => c !== "headers");
  return [...base, ...added];
}

describe("flow_session_steps: la sesión no lee lo que usó y dejó cada paso", () => {
  it("el GRANT por columnas no incluye input ni output", () => {
    const cols = grantedColumns();
    expect(cols).not.toContain("input");
    expect(cols).not.toContain("output");
  });

  it("el GRANT incluye todas las demás columnas de la tabla", () => {
    const expected = tableColumns().filter((c) => c !== "input" && c !== "output").sort();
    expect(grantedColumns().sort()).toEqual(expected);
  });

  it("lo que pide la pantalla de ejecuciones con la sesión está en el GRANT", () => {
    const code = readFileSync(join(root, "lib/flows/runs-query.ts"), "utf8");
    const granted = new Set(grantedColumns());
    const selects = [...code.matchAll(/from\("flow_session_steps"\)\s*\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      for (const col of select.split(",").map((c) => c.trim())) expect(granted.has(col), col).toBe(true);
    }
  });
});
