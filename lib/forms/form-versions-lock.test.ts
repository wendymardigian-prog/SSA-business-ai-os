/**
 * Formularios 00177 (R9): el candado de `form_versions`. Lo que garantiza la BASE lo prueba `verify-forms` contra la
 * base real; esto cuida que la migración siga nombrando cada columna que no se puede tocar y la excepción del
 * ON DELETE SET NULL (si no, borrar a quien publicó algo dejaría de andar).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/00177_form_versions_lock.sql", "utf8");
const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"), sql.lastIndexOf("DROP TRIGGER IF EXISTS form_versions_protect"));

describe("el candado de las versiones publicadas", () => {
  it("rechaza el cambio de cada columna que define lo que se firmó", () => {
    for (const column of ["workspace_id", "form_id", "version_number", "definition", "contract_text", "contract_text_sha256", "published_at"]) {
      expect(fn, column).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
    expect(fn).toContain("NEW.published_by IS DISTINCT FROM OLD.published_by");
  });

  it("deja pasar published_by -> NULL (la clave foránea) y nada más", () => {
    expect(fn).toContain("AND NEW.published_by IS NOT NULL");
  });

  it("usa restrict_violation, como el candado de las firmas, y es un BEFORE UPDATE (no bloquea el DELETE)", () => {
    expect(fn).toContain("ERRCODE = 'restrict_violation'");
    expect(sql).toMatch(/BEFORE UPDATE ON public\.form_versions/);
    expect(sql).not.toMatch(/BEFORE (DELETE|INSERT)/);
  });

  it("es idempotente y guarda cómo volver atrás", () => {
    expect(sql).toContain("DROP TRIGGER IF EXISTS form_versions_protect");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.form_versions_protect_published()");
    expect(sql).toContain("Como volver atras");
  });
});
