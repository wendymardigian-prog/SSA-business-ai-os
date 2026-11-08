/**
 * El nivel de calificación de un contacto se escribe en UN solo lugar.
 *
 * Las columnas `qualification_level`, `qualification_at` y `qualification_by_agent`
 * (00329) solo las cambia `set_contact_qualification`, y desde el código solo
 * `lib/contacts/qualification-core.ts`. Este test recorre el código de aplicación
 * y falla si aparece otra escritura. La base hace el mismo control con la guardia
 * `contacts_qualification_guard` (QL001).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];

const ALLOWED_FILE = join("lib", "contacts", "qualification-core.ts");
/** Declara el tipo de LECTURA (`Row`); las columnas no están en Insert ni Update. */
const DECLARES_ONLY = [join("lib", "types", "database.ts")];

/**
 * `.from("contacts")` y, a pocos renglones, un insert/update/upsert que trae una de las columnas. (Nombrarlas como
 * clave suelta no alcanza: las etiquetas del historial y el audit `changes` también las usan.)
 */
const CONTACTS_WRITE =
  /\.from\(\s*["'`]contacts["'`]\s*\)[\s\S]{0,200}?\.(insert|update|upsert)\s*\(\s*\{[\s\S]{0,600}?\bqualification_(level|at|by_agent)\s*:/;
/** Llamar a la función de la base por fuera del módulo. */
const RPC_CALL = /\.rpc\(\s*["'`]set_contact_qualification["'`]/;

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

export function qualificationWrites(source: string): string[] {
  const found: string[] = [];
  if (CONTACTS_WRITE.test(source)) found.push("escritura de la calificación sobre contacts");
  if (RPC_CALL.test(source)) found.push("llamada directa a set_contact_qualification");
  return found;
}

describe("la calificación se escribe solo desde lib/contacts/qualification-core.ts", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("ningún otro archivo de aplicación escribe la calificación", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (isExcluded(rel) || rel === ALLOWED_FILE || DECLARES_ONLY.includes(rel)) continue;
      const hits = qualificationWrites(readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("el módulo permitido llama a la función de la base", () => {
    expect(readFileSync(join(ROOT, ALLOWED_FILE), "utf8")).toMatch(RPC_CALL);
  });

  it("el control detecta cada forma de escribir (prueba del propio test)", () => {
    expect(qualificationWrites(`supabase.from("contacts").update({ qualification_level: 3 })`)).not.toEqual([]);
    expect(qualificationWrites(`service.rpc("set_contact_qualification", {})`)).not.toEqual([]);
    expect(qualificationWrites(`.select("id, qualification_level")`)).toEqual([]);
    expect(qualificationWrites(`changes: { qualification_level: { old: 1, new: 2 } }`)).toEqual([]);
  });
});
