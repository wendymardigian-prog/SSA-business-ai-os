import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Cada cron nuevo reescribe `private.call_app_cron` entera (patron desde la
 * 00036). Si alguien copia una version anterior a la 00139, la funcion vuelve a
 * leer el secreto de `private.system_config`, que desde la 00140 ya no lo
 * tiene: todos los cron dejan de correr sin ningun error visible.
 */
describe("private.call_app_cron (la definicion vigente)", () => {
  const body = latestCallAppCronBody();

  it("lee app_url y cron_secret de Vault, no de system_config", () => {
    expect(body).toContain("vault.decrypted_secrets");
    expect(body).toContain("'system:app_url'");
    expect(body).toContain("'system:cron_secret'");
    expect(body).not.toContain("private.system_config");
  });

  it("permite exactamente las rutas de app/api/cron que corren por pg_cron", () => {
    // purge-deleted queda fuera a proposito: la purga corre en SQL directo y
    // la ruta existe solo para correrla a mano (00036).
    const routes = readdirSync(join(repoRoot(), "app", "api", "cron"))
      .filter((name) => statSync(join(repoRoot(), "app", "api", "cron", name)).isDirectory())
      .filter((name) => name !== "purge-deleted")
      .sort();
    expect(whitelist(body)).toEqual(routes);
  });
});

function repoRoot(): string {
  return join(__dirname, "..");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function latestCallAppCronBody(): string {
  const dir = join(repoRoot(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const header = /CREATE OR REPLACE FUNCTION private\.call_app_cron\(/;
  let latest: string | null = null;
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(dir, file), "utf8"));
    const match = header.exec(sql);
    if (match) {
      const rest = sql.slice(match.index);
      latest = rest.slice(0, rest.indexOf("END; $$;") + "END; $$;".length);
    }
  }
  if (!latest) throw new Error("no se encontro ninguna definicion de private.call_app_cron");
  return latest;
}

function whitelist(body: string): string[] {
  const list = /p_path NOT IN \(([\s\S]*?)\)/.exec(body);
  if (!list) throw new Error("call_app_cron sin lista blanca de rutas");
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}
