/**
 * Lo que las migraciones de webhooks entrantes tienen que decir, leyendo el archivo (mismo patrón
 * que `lib/eod/migrations.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const body = (sql: string) => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("00186: tablas de webhooks entrantes", () => {
  const sql = body(read("00186_webhook_endpoints.sql"));
  it("el token no está entre las columnas que authenticated puede leer", () => {
    const grant = sql.slice(sql.indexOf("GRANT SELECT ("), sql.indexOf(") ON public.webhook_endpoints TO authenticated"));
    expect(grant).not.toMatch(/\btoken\b/);
    expect(grant).not.toContain("secret_vault_name");
  });
  it("no hay policies de escritura para authenticated", () => {
    expect(sql).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
});

describe("00187: sesiones de webhook y el disparador", () => {
  const sql = body(read("00187_webhook_sessions.sql"));
  const types = (name: string) => {
    const check = body(read(name));
    const from = check.slice(check.indexOf("ADD CONSTRAINT triggers_type_check"));
    return [...from.slice(0, from.indexOf("]));")).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  };

  it("son los 31 de la 00183 más webhook_received", () => {
    const before = types("00183_trigger_type_eod.sql");
    expect(before).toHaveLength(31);
    expect(types("00187_webhook_sessions.sql")).toEqual([...before, "webhook_received"]);
  });

  it("el CHECK de las sesiones suma el webhook como tercera salida", () => {
    expect(sql).toContain("CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL OR inbound_webhook_id IS NOT NULL)");
  });

  it("la cabecera guarda la definición vieja para volver atrás", () => {
    const header = read("00187_webhook_sessions.sql");
    expect(header).toContain("CHECK (((contact_id IS NOT NULL) OR (member_user_id IS NOT NULL)))");
    expect(header).toContain("'eod_submitted'::text");
  });

  it("no vuelve a aflojar el NOT NULL de contact_id (ya lo hizo la 00182)", () => {
    expect(sql).not.toMatch(/ALTER COLUMN contact_id/);
  });
});
