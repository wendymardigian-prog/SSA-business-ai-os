/**
 * La configuración por defecto de Finanzas vive en DOS lugares: el default de la columna
 * `workspaces.finance_settings` (migración 00225) y `defaultFinanceSettings()`. Si se separan, un negocio
 * nuevo nace con categorías distintas a las que el código espera.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { defaultFinanceSettings } from "./settings";
import { DEFAULT_EXPENSE_CATEGORIES } from "./categories";

describe("paridad del default de finance_settings con la migración 00225", () => {
  const sql = readFileSync("supabase/migrations/00225_finance_tables.sql", "utf8");
  const match = sql.match(/ADD COLUMN IF NOT EXISTS finance_settings jsonb NOT NULL DEFAULT '(\{.*\})'::jsonb;/);

  it("la migración trae el default", () => {
    expect(match).not.toBeNull();
  });

  it("es idéntico a defaultFinanceSettings()", () => {
    const fromSql = JSON.parse(match![1]);
    expect(fromSql).toEqual(JSON.parse(JSON.stringify(defaultFinanceSettings())));
  });

  it("las claves de categoría de la migración son las mismas 12 que usa el código", () => {
    const fromSql = JSON.parse(match![1]) as { expense_categories: Array<{ key: string }> };
    expect(fromSql.expense_categories.map((c) => c.key)).toEqual(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.key));
  });
});
