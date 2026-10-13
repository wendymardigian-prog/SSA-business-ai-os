/**
 * La migracion 00200 (la regla unica): lo que no se puede romper, leyendo el SQL.
 * La verdad se prueba contra la base real en scripts/verify-contacts-single-entry.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/00200_find_or_create_contact.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("00200_find_or_create_contact", () => {
  it("la central es SECURITY DEFINER con search_path vacio", () => {
    const def = code.slice(code.indexOf("CREATE OR REPLACE FUNCTION public.find_or_create_contact"));
    expect(def).toMatch(/SECURITY DEFINER/);
    expect(def).toMatch(/SET search_path TO ''/);
  });

  it("solo service_role puede ejecutar lo publico", () => {
    expect(code).toContain("REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;");
    expect(code).toContain("GRANT EXECUTE ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) TO service_role;");
    expect(code).toContain("REVOKE ALL ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon, authenticated;");
    expect(code).not.toMatch(/GRANT EXECUTE[^;]*TO (anon|authenticated|PUBLIC)/);
  });

  it("las funciones de private no se exponen", () => {
    for (const fn of ["contact_normalize_identity(jsonb)", "contact_identity_lookup(uuid, jsonb)", "contact_value_taken(uuid, uuid, text, text)"]) {
      expect(code).toContain(`REVOKE ALL ON FUNCTION private.${fn} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("es la unica que inserta en contacts", () => {
    const inserts = code.match(/INSERT INTO public\.contacts\b/g) ?? [];
    expect(inserts).toHaveLength(1);
  });

  it("toma los bloqueos ordenados por clave, tambien en find_only", () => {
    expect(code).toMatch(/ORDER BY k COLLATE "C"/);
    expect(code.indexOf("pg_advisory_xact_lock")).toBeLessThan(code.indexOf("IF p_mode = 'find_only'"));
  });

  it("no deja pisar lo estructural con los defaults", () => {
    for (const col of ["'id'", "'workspace_id'", "'deleted_at'", "'created_at'", "'updated_at'"]) expect(code).toContain(col);
  });

  it("es idempotente: solo CREATE OR REPLACE, sin DROP", () => {
    expect(code).not.toMatch(/\bDROP\b/);
    expect(code).not.toMatch(/CREATE FUNCTION/);
  });
});
