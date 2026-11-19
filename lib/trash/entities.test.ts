import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, MEMBER_PERMISSION_KEYS, OWNER_ONLY_KEYS } from "@/lib/auth/permissions";
import { daysLeft, isTrashEntity, TRASH_ENTITIES, TRASH_PERMISSION_KEYS } from "./entities";
import { blockerMessage, blockerMessages, describeCounts, restoreErrorMessage, warningMessage } from "./messages";

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

/** La última definición de una función en las migraciones (la vigente). */
function lastDefinition(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{5}_.+\.sql$/.test(f)).sort();
  let found = "";
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    const re = new RegExp(`CREATE OR REPLACE FUNCTION ${name.replace(".", "\\.")}\\([\\s\\S]*?\\$\\$;`, "g");
    const all = sql.match(re);
    if (all) found = all[all.length - 1];
  }
  return found;
}

describe("Papelera: TypeScript y la base dicen lo mismo", () => {
  it("private.trash_can pide la misma clave que TRASH_ENTITIES para cada tipo", () => {
    const sql = lastDefinition("private.trash_can");
    const pairs = Array.from(sql.matchAll(/WHEN '([a-z_]+)'\s+THEN public\.has_permission\(p_workspace_id, '([a-z_.]+)'\)/g)).map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(pairs)).toEqual(Object.fromEntries(Object.entries(TRASH_ENTITIES).map(([k, v]) => [k, v.key])));
  });

  it("private.trash_plan sabe eliminar cada tipo", () => {
    const sql = lastDefinition("private.trash_plan");
    const handled = Array.from(sql.matchAll(/^\s*WHEN '([a-z_]+)' THEN/gm)).map((m) => m[1]).sort();
    expect(handled).toEqual(Object.keys(TRASH_ENTITIES).sort());
  });

  it("cada clave de eliminar existe en el catálogo, no es del Member ni solo del Owner", () => {
    const keys = new Set(PERMISSION_KEYS.map((p) => p.key));
    for (const key of TRASH_PERMISSION_KEYS) {
      expect(keys.has(key), key).toBe(true);
      if (key === "contacts.delete" || key === "tasks.delete") continue; // ya existían, con sus reglas
      expect(MEMBER_PERMISSION_KEYS as readonly string[]).not.toContain(key);
      expect(OWNER_ONLY_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it("isTrashEntity solo acepta los tipos del catálogo", () => {
    expect(isTrashEntity("sale")).toBe(true);
    expect(isTrashEntity("contact")).toBe(false);
    expect(isTrashEntity("toString")).toBe(false);
    expect(isTrashEntity(null)).toBe(false);
  });
});

describe("Papelera: textos", () => {
  it("cada bloqueo y aviso que devuelve la base tiene su texto", () => {
    const sql = lastDefinition("private.trash_plan");
    const blockers = new Set(Array.from(sql.matchAll(/array_append\(v_blockers, '([a-z_]+)'\)/g)).map((m) => m[1]));
    const warnings = new Set(Array.from(sql.matchAll(/array_append\(v_warnings, '([a-z_]+)'\)/g)).map((m) => m[1]));
    expect(blockers.size).toBeGreaterThan(3);
    for (const b of blockers) expect(blockerMessage(b), b).not.toBe("No se puede eliminar.");
    for (const w of warnings) if (w !== "has_service") expect(warningMessage(w), w).toBeTruthy();
  });

  it("un bloqueo del motor nombra la tabla en castellano", () => {
    expect(blockerMessage("in_use:public.sales")).toContain("ventas");
    expect(blockerMessage("in_use:public.algo_nuevo")).toContain("public.algo_nuevo");
  });

  it("un bloqueo propio no se repite con el genérico «Lo usan otros registros» de la misma tabla", () => {
    expect(blockerMessages(["contract_signed", "in_use:public.contract_signatures"])).toEqual([blockerMessage("contract_signed")]);
    expect(blockerMessages(["product_sold", "in_use:public.sales", "in_use:app_servicio.services"])).toEqual([
      blockerMessage("product_sold"),
      blockerMessage("in_use:app_servicio.services"),
    ]);
    // Sin el bloqueo propio, el genérico sí se muestra; y los iguales van una sola vez.
    expect(blockerMessages(["in_use:public.contract_signatures"])).toEqual([blockerMessage("in_use:public.contract_signatures")]);
    expect(blockerMessages(["contract_signed", "contract_signed"])).toHaveLength(1);
  });

  it("lo que se va con el registro no cuenta el registro mismo", () => {
    expect(describeCounts({ "public.sales": 1, "public.payments": 3, "public.commissions": 1 }, "public.sales")).toEqual(["3 pagos", "1 comisión"]);
    expect(describeCounts({ "public.payments": 2, "public.commissions": 0 }, "public.payments")).toEqual(["1 pago"]);
    expect(describeCounts({ "app_servicio.trigger_anchor_fires": 4 }, null)).toEqual([]);
  });

  it("restaurar sin el padre dice qué restaurar primero", () => {
    expect(restoreErrorMessage("missing_parent:public.sales")).toContain("la venta");
    expect(restoreErrorMessage("expired")).toContain("30 días");
  });

  it("los días que quedan", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(daysLeft("2026-11-20T11:00:00Z", now)).toBe(2);
    expect(daysLeft("2026-11-18T11:00:00Z", now)).toBe(0);
    expect(daysLeft("no-es-fecha", now)).toBe(0);
  });
});
