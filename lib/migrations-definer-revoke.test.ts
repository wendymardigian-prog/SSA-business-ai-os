import { describe, expect, it } from "vitest";
import { listMigrations, migrationNumber, readMigration } from "@/lib/test-utils/migrations";

/**
 * Funciones SECURITY DEFINER: la red de seguridad de la auditoría del 19/11/2026.
 *
 * La 00000 le da EXECUTE a anon y authenticated sobre toda función nueva, y un `ALTER DEFAULT PRIVILEGES IN SCHEMA
 * app_servicio REVOKE ... FROM public` no lo deshace (Postgres no revoca por esquema lo que se dio en global). Así que
 * cada función SECURITY DEFINER tiene que revocar a mano. Una que se olvida corre con permisos de dueño para
 * cualquiera con una sesión (o sin sesión, si queda para anon). Desde la 00317 (lo que cubrió la auditoría), toda
 * SECURITY DEFINER tiene su `REVOKE ... FROM PUBLIC`.
 */

const CHECK_FROM = 317;
const files = listMigrations();

function code(file: string): string {
  return readMigration(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

/** Cada sentencia GRANT/REVOKE de todas las migraciones, en orden, sin saltos de línea. */
const privilegeStatements = files.flatMap((file) =>
  code(file)
    .split(";")
    .map((st) => st.replace(/\s+/g, " ").trim())
    .filter((st) => /^(grant|revoke)\b/i.test(st) && /\bfunction\b/i.test(st)),
);

/**
 * Algunas migraciones revocan en un bucle (`DO $$ ... FOR f IN SELECT ... WHERE p.proname IN ('a','b') ... EXECUTE
 * format('REVOKE ALL ON FUNCTION %s FROM public, anon', ...)`): los nombres de esas listas cuentan como revocados.
 */
const loopRevoked = new Set(
  files.flatMap((file) =>
    [...code(file).matchAll(/do\s+\$\$([\s\S]*?)\$\$/gi)]
      .map((m) => m[1])
      .filter((block) => /execute\s+format\(\s*'revoke[^']*from\s+public/i.test(block))
      .flatMap((block) => [...block.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].map((n) => n[1].toLowerCase())),
  ),
);

function mentions(statement: string, qualified: string): boolean {
  const [schema, name] = qualified.split(".");
  return new RegExp(`(?:\\b${schema}\\.)?\\b${name}\\s*\\(`, "i").test(statement) && statement.toLowerCase().includes(name.toLowerCase());
}

describe("toda SECURITY DEFINER nueva revoca el EXECUTE por defecto", () => {
  const definers = files
    .filter((f) => migrationNumber(f) >= CHECK_FROM)
    .flatMap((file) =>
      [...code(file).matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\$\$/gi)]
        .filter((m) => /security\s+definer/i.test(m[3]))
        .map((m) => ({ file, fn: `${m[1]}.${m[2]}`.toLowerCase() })),
    );
  const unique = [...new Map(definers.map((d) => [d.fn, d])).values()];

  it("encontró funciones para revisar", () => {
    expect(unique.length).toBeGreaterThan(20);
  });

  it.each(unique.map((d) => [d.fn, d.file]))("%s (%s)", (fn) => {
    const revoked = loopRevoked.has(fn.split(".")[1]) || privilegeStatements.some((st) => /^revoke\b/i.test(st) && /\bfrom\b[^]*\bpublic\b/i.test(st) && mentions(st, fn));
    expect(revoked, `${fn} es SECURITY DEFINER y nunca revoca el EXECUTE de PUBLIC`).toBe(true);
  });
});

describe("lo que la auditoría del 19/11 cerró queda cerrado", () => {
  // La ÚLTIMA sentencia de permisos sobre cada una no puede dársela a authenticated ni a anon.
  it.each(["app_servicio.portal_admin_invite", "app_servicio.portal_admin_invite_issue", "app_servicio.program_live_recordings", "public.affiliate_by_code"])(
    "%s no se puede llamar con la sesión",
    (fn) => {
      const grants = privilegeStatements.filter((st) => /^grant\b/i.test(st) && mentions(st, fn));
      const last = grants.at(-1) ?? "";
      expect(last, `la última concesión de ${fn}`).not.toMatch(/\bto\b[^]*\b(authenticated|anon)\b/i);
    },
  );
});
