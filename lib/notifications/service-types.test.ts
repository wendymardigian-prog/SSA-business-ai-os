// @plantilla-quitar(servicios)
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "./types";
import { eventForType } from "./preferences";

/**
 * Servicios A2 (F124): los avisos que escribe la base del modulo (`app_servicio.notify` / `notify_admins`) estan en el
 * catalogo y en una fila de las preferencias. Antes no estaban: la campana los mostraba con el respaldo y `deliver`
 * los descartaba. Si una migracion suma un aviso nuevo del modulo, este test pide sumarlo al catalogo.
 */
const dir = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{5}_.*\.sql$/.test(f));
const sqlTypes = new Set<string>();
for (const f of files) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/app_servicio\.notify(?:_admins)?\([^']*'([a-z_]+)'/g)) sqlTypes.add(m[1]);
  for (const m of src.matchAll(/VALUES \([^)]*?'(commission_unassigned)'/g)) sqlTypes.add(m[1]);
}

describe("los avisos del módulo de Servicios están en el catálogo", () => {
  it("encuentra los avisos de la base", () => expect([...sqlTypes].filter((t) => t.startsWith("svc_")).length).toBeGreaterThanOrEqual(11));
  for (const t of sqlTypes) {
    it(t, () => {
      expect(NOTIFICATION_TYPES as readonly string[]).toContain(t);
      expect(eventForType(t as never), `${t} tiene su fila en las preferencias`).toBeTruthy();
    });
  }
});
