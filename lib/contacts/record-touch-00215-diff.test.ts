/**
 * La 00215 reescribe `record_contact_touch` SOLO para escribir `entry_url` (plano formularios-ui, F18).
 *
 * Es la funcion mas caliente del sistema (la llama cada mensaje entrante), asi que este test falla si la
 * definicion nueva difiere de la vieja en algo mas que esas lineas. Mismo patron que
 * `c2-migrations-diff.test.ts`. Tambien comprueba que la definicion VIEJA copiada en la cabecera es
 * la leida de la base (su md5), para que "volver atras" sea literal.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(join(__dirname, "../../supabase/migrations/00215_contact_touch_entry_url.sql"), "utf8");

function oldDefinition(): string {
  const lines = SQL.split("\n");
  const start = lines.findIndex((l) => l.startsWith("-- CREATE OR REPLACE FUNCTION public.record_contact_touch"));
  const end = lines.findIndex((l, i) => i > start && l === "-- $function$");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lines
    .slice(start, end + 1)
    .map((l) => (l === "--" ? "" : l.replace(/^-- ?/, "")))
    .join("\n");
}

function newDefinition(): string {
  const idx = SQL.indexOf("\nCREATE OR REPLACE FUNCTION public.record_contact_touch");
  expect(idx).toBeGreaterThan(-1);
  return SQL.slice(idx + 1).replace(/;\s*$/, "");
}

/** Lineas que estan en `a` y no en `b` (multiconjunto, en orden). */
function onlyIn(a: string[], b: string[]): string[] {
  const pool = [...b];
  const out: string[] = [];
  for (const line of a) {
    const i = pool.indexOf(line);
    if (i >= 0) pool.splice(i, 1);
    else out.push(line);
  }
  return out;
}

describe("00215: record_contact_touch cambia solo por entry_url", () => {
  it("la definicion vieja de la cabecera es la de la base (md5 leido el 13/10/2026)", () => {
    expect(createHash("md5").update(`${oldDefinition()}\n`).digest("hex")).toBe("f364db1862cc0f90291ca14ef855a214");
  });

  it("las unicas lineas que salen son la de la lista de columnas, y las que entran son las de entry_url", () => {
    const oldLines = oldDefinition().split("\n");
    const newLines = newDefinition().split("\n");

    expect(onlyIn(oldLines, newLines)).toEqual(["    referrer_url, landing_page, origin, dedupe_key, raw"]);

    const added = onlyIn(newLines, oldLines).map((l) => l.trim());
    expect(added).toEqual([
      "referrer_url, landing_page, entry_url, origin, dedupe_key, raw",
      "-- La URL de entrada completa (plano formularios-ui, F18). Un formulario la manda como `entry_url`; la Agenda,",
      "-- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi), asi que `create_booking` NO se toca.",
      "-- Hasta 2000 caracteres: lo que pase de eso se corta, nunca hace fallar el toque.",
      "left(",
      "coalesce(",
      "nullif(btrim(p_touch->>'entry_url'), ''),",
      "nullif(btrim(p_touch->'raw'->'utm'->>'entry_url'), '')",
      "),",
      "2000",
      "),",
    ]);
  });

  it("mantiene la firma, el tipo de retorno, SECURITY DEFINER y search_path vacio", () => {
    const def = newDefinition();
    expect(def).toContain("record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb)");
    expect(def).toContain("RETURNS jsonb");
    expect(def).toContain("SECURITY DEFINER");
    expect(def).toContain("SET search_path TO ''");
  });

  const code = () => SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("agrega la columna sin CHECK (un CHECK violado pone la URL en el log) y de forma idempotente", () => {
    expect(code()).toMatch(/ALTER TABLE public\.contact_touches ADD COLUMN IF NOT EXISTS entry_url text;/);
    expect(code()).not.toMatch(/CHECK|CONSTRAINT/i);
  });

  it("lo unico que crea o reescribe es record_contact_touch (ni create_booking ni contact_touch_json)", () => {
    const created = [...code().matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/gi)].map((m) => m[1]);
    expect(created).toEqual(["public.record_contact_touch"]);
    expect(code()).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
  });
});
