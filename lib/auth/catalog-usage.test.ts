/**
 * Toda clave visible del catalogo se USA (Equipo y roles, F2).
 *
 * La pantalla de roles llegó a mostrar 54 claves de las cuales 18 no hacian nada: se tildaban, se
 * guardaban, y ningun guard, menu ni politica las miraba. Este test recorre el codigo real y falla
 * si una clave visible del catalogo no aparece en ningun lugar que decida algo.
 *
 * Cuenta como "uso": un guard (`requirePermission`, `getPermissionAction`, `requireAnyPermission`,
 * `can("...")`), una lista de `permissions` del menu / pestañas / botones, o un
 * `has_permission(..., '<clave>')` en las migraciones. NO cuenta el catalogo, las plantillas de roles
 * ni los tests: una clave que solo aparece ahi sigue siendo una promesa vacia.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { VISIBLE_PERMISSION_KEYS } from "@/lib/auth/permissions";

const ROOT = process.cwd();

/** Claves que todavia no tienen su uso: cada una dice en que bloque llega. Al cerrar B5 esta lista queda VACIA (y asi tiene que seguir). */
const PENDING: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const EXCLUDED = [
  "lib/auth/permissions.ts",
  "lib/auth/roles-admin.ts",
  "lib/roles/templates.ts",
  "lib/types/database.ts",
  "supabase/migrations/ALL_MIGRATIONS.sql",
];

/** Sin comentarios (una clave nombrada en un comentario no decide nada) ni las listas de paridad de la 00208. */
function code(file: string, text: string): string {
  if (file.endsWith(".sql")) {
    return text
      .replace(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+private\.(?:member_permission_keys|owner_only_keys)\(\)[\s\S]*?\$\$;/gi, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sources(): string[] {
  const files = ["app", "lib", "components"].flatMap((d) => walk(path.join(ROOT, d)));
  const sql = walk(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  return [...files, ...sql]
    .filter((f) => /\.(ts|tsx|sql)$/.test(f))
    .filter((f) => !/\.(test|characterization\.test)\.tsx?$/.test(f) && !f.includes("/testing/"))
    .filter((f) => !EXCLUDED.includes(path.relative(ROOT, f).split(path.sep).join("/")))
    .map((f) => code(f, readFileSync(f, "utf8")));
}

describe("catalogo de permisos: toda clave visible tiene un uso", () => {
  const all = sources().join("\n");

  for (const { key } of VISIBLE_PERMISSION_KEYS) {
    if (key in PENDING) continue;
    it(`${key} aparece en un guard, un menu o una politica`, () => {
      // La clave entre comillas (TypeScript) o entre apostrofes (SQL).
      const used = all.includes(`"${key}"`) || all.includes(`'${key}'`) || all.includes(`\`${key}\``);
      expect(used, `La clave ${key} no la usa ningun guard, menu ni politica`).toBe(true);
    });
  }

  it("la lista de pendientes solo nombra claves que existen", () => {
    for (const key of Object.keys(PENDING)) {
      expect(VISIBLE_PERMISSION_KEYS.map((p) => p.key)).toContain(key);
    }
  });
});
