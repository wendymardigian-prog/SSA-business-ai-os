/**
 * El historial de productos y variantes lo escribe la BASE (trigger `catalog_audit`, 00170).
 * Si `lib/actions/products.ts` volviera a llamar a `logAudit` o a un helper `audit(...)`,
 * cada cambio quedaría registrado dos veces. Este test lo atrapa.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("el historial del catálogo no se escribe desde las acciones", () => {
  it("products.ts no importa ni llama a logAudit", () => {
    const source = code("lib/actions/products.ts");
    expect(source).not.toMatch(/logAudit/);
    expect(source).not.toMatch(/diffFields/);
    expect(source).not.toMatch(/\baudit\(/);
    expect(source).not.toMatch(/from\("audit_log"\)/);
  });

  it("la migración 00170 deja un trigger en products y otro en product_variants", () => {
    const sql = readFileSync("supabase/migrations/00170_catalog_audit_triggers.sql", "utf8");
    expect(sql).toMatch(/CREATE TRIGGER products_audit\s+AFTER INSERT OR UPDATE OR DELETE ON public\.products/);
    expect(sql).toMatch(/CREATE TRIGGER product_variants_audit\s+AFTER INSERT OR UPDATE OR DELETE ON public\.product_variants/);
  });
});
