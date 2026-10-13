/**
 * La regla unica "buscar o crear contacto": NADIE inserta en `contacts` por su cuenta.
 *
 * Todo contacto nuevo nace en `find_or_create_contact` (00200), a traves de `lib/contacts/find-or-create.ts`
 * (o de las funciones de la base que la llaman: `find_or_link_contact`, `create_booking`,
 * `submit_form_response`). Este test recorre el codigo de aplicacion y falla si aparece un
 * `.from("contacts").insert(...)` / `.upsert(...)` en cualquier otro lado: una busqueda propia, aunque sea
 * buena, vuelve a abrir la puerta a duplicados por carrera y a normalizaciones distintas.
 *
 * Mismo patron que lib/response-assets/table-boundary.test.ts. `scripts/verify-contacts-single-entry.mjs`
 * hace el mismo control del lado de la base (ninguna funcion salvo la central inserta en contacts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];

/** `.from("contacts")` seguido (a lo sumo unos renglones despues) de `.insert(` o `.upsert(`. */
const FORBIDDEN = /\.from\(\s*["'`]contacts["'`]\s*\)[\s\S]{0,160}?\.(insert|upsert)\s*\(/;

/** Los unicos archivos que pueden insertar en contacts: ninguno de aplicacion (la insercion esta en la base). */
const ALLOWED_APP_FILES: string[] = [];

/**
 * Los scripts de verificacion arman contactos `zz-test-` como datos de prueba contra la base real: no son
 * codigo de aplicacion y los tests (`*.test.ts`) arman filas en memoria.
 */
function isExcluded(relPath: string): boolean {
  const name = relPath.split(sep).pop() ?? "";
  if (name.includes(".test.")) return true;
  if (relPath.startsWith(`scripts${sep}`) && /^verify-.*\.(mjs|ts)$/.test(name)) return true;
  if (relPath.includes(`${sep}testing${sep}`)) return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

describe("la regla unica de contactos: nadie inserta en contacts por su cuenta", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("el escaneo encuentra archivos de verdad (no pasa en vacio)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith(join("lib", "contacts", "find-or-create.ts")))).toBe(true);
  });

  it("ningun archivo de aplicacion hace .from('contacts').insert/upsert", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (isExcluded(rel) || ALLOWED_APP_FILES.includes(rel)) continue;
      if (FORBIDDEN.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `Estos archivos insertan en contacts sin pasar por lib/contacts/find-or-create.ts: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("el detector detecta: un insert directo, en una o en varias lineas", () => {
    expect(FORBIDDEN.test('await supabase.from("contacts").insert({ a: 1 })')).toBe(true);
    expect(FORBIDDEN.test('db\n  .from("contacts")\n  .upsert([])')).toBe(true);
    expect(FORBIDDEN.test('db.from("contacts").select("id")')).toBe(false);
    expect(FORBIDDEN.test('db.from("contact_tags").insert({})')).toBe(false);
  });

  it("find-or-create.ts es el unico lugar donde se habla de find_or_create_contact", () => {
    const callers = files
      .map((f) => relative(ROOT, f))
      .filter((rel) => !isExcluded(rel) && !rel.startsWith(`lib${sep}types${sep}`))
      .filter((rel) => /rpc\(\s*["']find_or_create_contact["']/.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(callers).toEqual([join("lib", "contacts", "find-or-create.ts")]);
  });
});
