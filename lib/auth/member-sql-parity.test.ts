/**
 * Paridad TypeScript ↔ SQL de los permisos que la base tiene que conocer.
 *
 * `has_permission` no puede leer `lib/auth/permissions.ts`: la lista del Member de sistema y
 * las claves solo-Owner viven COPIADAS en `private.member_permission_keys()` y
 * `private.owner_only_keys()`. Si alguien cambia la lista en TypeScript y no en SQL (o al reves), el
 * Member tendria en la pantalla un permiso que la base le niega, o lo contrario, sin que nada lo diga.
 *
 * El test lee la ULTIMA definicion de cada funcion en `supabase/migrations/` (la que gana en la base).
 */
import { describe, expect, it } from "vitest";
import { lastFunctionDefinition } from "@/lib/test-utils/migrations";
import { MEMBER_PERMISSION_KEYS, OWNER_ONLY_KEYS, PERMISSION_KEYS, SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { MEMBER_CHANNELS } from "@/lib/auth/channel-permissions";

/** Las claves de la ultima definicion de `private.<fn>()` (sin las que viven en un comentario). */
function latestKeys(fn: string): { file: string; keys: string[] } {
  const def = lastFunctionDefinition(`private.${fn}`);
  const m = def?.sql.match(/ARRAY\[([\s\S]*?)\]/);
  if (!def || !m) throw new Error(`No encontre private.${fn}() en supabase/migrations/`);
  return { file: def.file, keys: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
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

  it("private.ungrantable_keys() son las solo-Owner y las reservadas: las que ningun rol lleva", () => {
    const { keys, file } = latestKeys("ungrantable_keys");
    const expected = PERMISSION_KEYS.filter((p) => p.ownerOnly || p.reserved).map((p) => p.key);
    expect([...keys].sort(), `ultima definicion: ${file}`).toEqual([...expected].sort());
  });

  it("private.member_channels() es la bandeja del Member de sistema (MEMBER_CHANNELS)", () => {
    const def = lastFunctionDefinition("private.member_channels");
    const m = def?.sql.match(/SELECT\s+'([^']+)'::jsonb/i);
    const found = def && m ? { file: def.file, value: JSON.parse(m[1]) as unknown } : null;
    expect(found, "No encontre private.member_channels() en supabase/migrations/").not.toBeNull();
    expect(found!.value, `ultima definicion: ${found!.file}`).toEqual(MEMBER_CHANNELS);
    expect(SYSTEM_ROLE_PERMISSIONS.member.channels).toEqual(MEMBER_CHANNELS);
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
