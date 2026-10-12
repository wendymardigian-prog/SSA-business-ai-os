/**
 * Lo que las migraciones del EOD tienen que decir, leyendo el archivo (mismo patrón que
 * `lib/sales/automation/triggers-check.test.ts`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const body = (sql: string) => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("00178: el tipo eod", () => {
  const sql = body(read("00178_forms_type_eod.sql"));
  it("CUANDO se aplica, el CHECK de forms.type tiene los tres tipos viejos más eod", () => {
    const check = sql.slice(sql.indexOf("ADD CONSTRAINT forms_type_check"));
    const types = [...check.slice(0, check.indexOf("]));")).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    expect(types).toEqual(["custom", "survey", "contract", "eod"]);
  });
  it("eod_config es obligatoria para un eod", () => {
    expect(sql).toContain("(type <> 'eod'::text) OR (eod_config IS NOT NULL)");
  });
});

describe("00179: get_public_form sin eod", () => {
  it("es la 00174 con una sola condición más", () => {
    const old = body(read("00174_get_public_form_social.sql")).trim();
    const now = body(read("00179_get_public_form_sin_eod.sql")).trim();
    const added = now.split("\n").filter((l) => !old.split("\n").includes(l));
    expect(added.map((l) => l.trim())).toEqual(["AND f.current_version_id IS NOT NULL", "AND f.type <> 'eod';"]);
  });
});
