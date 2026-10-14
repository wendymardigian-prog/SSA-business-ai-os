/**
 * Paridad TypeScript ↔ SQL de los permisos que la base tiene que conocer.
 *
 * `has_permission` (00208) no puede leer `lib/auth/permissions.ts`: la lista del Member de sistema y
 * las claves solo-Owner viven COPIADAS en `private.member_permission_keys()` y
 * `private.owner_only_keys()`. Si alguien cambia la lista en TypeScript y no en SQL (o al reves), el
 * Member tendria en la pantalla un permiso que la base le niega, o lo contrario, sin que nada lo diga.
 *
 * El test lee la ULTIMA definicion de cada funcion en `supabase/migrations/` (la que gana en la base).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MEMBER_PERMISSION_KEYS, OWNER_ONLY_KEYS, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const DIR = path.join(process.cwd(), "supabase/migrations");

/** Las claves de la ultima migracion que redefine `private.<fn>()`. */
function latestKeys(fn: string): { file: string; keys: string[] } {
  const files = readdirSync(DIR)
    .filter((f) => /^\d{5}_.*\.sql$/.test(f))
    .sort();
  for (const file of [...files].reverse()) {
    const sql = readFileSync(path.join(DIR, file), "utf8");
    // Solo la definicion real (no las que viven dentro de un comentario "-- ...").
    const code = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    const m = code.match(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+private\\.${fn}\\(\\)[\\s\\S]*?ARRAY\\[([\\s\\S]*?)\\]`, "i"));
    if (m) return { file, keys: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
  }
  throw new Error(`No encontre private.${fn}() en supabase/migrations/`);
}

describe("paridad de permisos TypeScript ↔ SQL", () => {
  it("private.member_permission_keys() es exactamente la lista del Member de sistema", () => {
    const { keys, file } = latestKeys("member_permission_keys");
    expect([...keys].sort(), `ultima definicion: ${file}`).toEqual([...SYSTEM_ROLE_PERMISSIONS.member.keys].sort());
    expect([...keys].sort()).toEqual([...MEMBER_PERMISSION_KEYS].sort());
  });

  it("private.owner_only_keys() son las claves ownerOnly del catalogo", () => {
    const { keys, file } = latestKeys("owner_only_keys");
    expect([...keys].sort(), `ultima definicion: ${file}`).toEqual([...OWNER_ONLY_KEYS].sort());
  });

  it("el Admin de sistema no tiene ninguna clave solo-Owner, y el Owner si", () => {
    for (const key of OWNER_ONLY_KEYS) {
      expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).not.toContain(key);
      expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toContain(key);
    }
  });

  it("el Member no tiene ninguna clave solo-Owner ni reservada", () => {
    for (const key of OWNER_ONLY_KEYS) expect(SYSTEM_ROLE_PERMISSIONS.member.keys).not.toContain(key);
  });
});
