/**
 * El historial de productos y variantes lo escribe la BASE (trigger `catalog_audit`).
 * Si `lib/actions/products.ts` volviera a llamar a `logAudit` o a un helper `audit(...)`,
 * cada cambio quedaría registrado dos veces. Este test lo atrapa.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lastDefinition } from "@/lib/test-utils/migrations";

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

  it("las migraciones dejan un trigger en products y otro en product_variants (alta, cambio y baja)", () => {
    // Los tres eventos, en el orden que sea (la base los devuelve como INSERT OR DELETE OR UPDATE).
    const events = "(?:INSERT|UPDATE|DELETE)(?:\\s+OR\\s+(?:INSERT|UPDATE|DELETE)){2}";
    for (const [trigger, table] of [["products_audit", "products"], ["product_variants_audit", "product_variants"]]) {
      const found = lastDefinition(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+${trigger}\\s+AFTER\\s+(${events})\\s+ON\\s+public\\.${table}\\b`, "i"));
      expect(found, trigger).not.toBeNull();
      expect(new Set(found!.match[1].split(/\s+OR\s+/)), trigger).toEqual(new Set(["INSERT", "UPDATE", "DELETE"]));
    }
  });
});
