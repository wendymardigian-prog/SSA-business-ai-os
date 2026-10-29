/**
 * El estado de email de un contacto se escribe en UN solo lugar.
 *
 * Las cinco columnas (`email_status`, `email_status_at`, `email_status_source`,
 * `email_subscribed_at`, `email_unsubscribe_token`, 00270) solo las cambian
 * `set_email_status` / `set_email_status_by_address` (00271), y desde el codigo solo
 * `lib/email/subscription.ts`. Este test recorre el codigo de aplicacion y falla si
 * aparece otra escritura. La base hace el mismo control con la guardia
 * `contacts_email_status_guard`, y `scripts/verify-email-subscription.mjs` revisa que
 * ninguna funcion SQL salvo las centrales escriba esas columnas.
 *
 * `email_status` tambien es una columna de `contract_signatures` (copia del
 * contrato) y de `workspace_invites` (invitaciones): esas no son esta y no se
 * cuentan, porque el control mira las escrituras sobre `contacts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "app", "components", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];

/** El unico archivo de aplicacion que escribe el estado de email. */
const ALLOWED_FILES = [join("lib", "email", "subscription.ts")];

/**
 * Archivos que nombran las columnas sin escribirlas, con el motivo:
 * - lib/types/database.ts declara el tipo de LECTURA (`Row`); las columnas no estan en Insert ni Update.
 */
const DECLARES_ONLY = [join("lib", "types", "database.ts")];

/** Las columnas que solo existen en `contacts`: nombrarlas como clave de un objeto es escribirlas. */
const CONTACT_ONLY_KEYS = /\b(email_status_at|email_status_source|email_subscribed_at|email_unsubscribe_token)\s*:/;

/** `.from("contacts")` y, a pocos renglones, un insert/update/upsert que trae `email_status`. */
const CONTACTS_WRITE = /\.from\(\s*["'`]contacts["'`]\s*\)[\s\S]{0,200}?\.(insert|update|upsert)\s*\(\s*\{[\s\S]{0,600}?\bemail_status\s*:/;

/** Llamar a las funciones de la base por fuera del modulo. */
const RPC_CALL = /\.rpc\(\s*["'`](set_email_status|set_email_status_by_address)["'`]/;

/**
 * Excluidos con lista explicita: los tests arman filas en memoria y los scripts de
 * verificacion prueban la guardia contra la base real con datos `zz-test-`.
 */
function isExcluded(relPath: string): boolean {
  const name = relPath.split(sep).pop() ?? "";
  if (name.includes(".test.")) return true;
  if (relPath.startsWith(`scripts${sep}`) && /^verify-.*\.(mjs|ts)$/.test(name)) return true;
  if (relPath.startsWith(`scripts${sep}fixtures${sep}`)) return true;
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

/** Lo que encuentra el control en un texto (exportado para probar el propio control). */
export function emailStatusWrites(source: string): string[] {
  const found: string[] = [];
  if (CONTACT_ONLY_KEYS.test(source)) found.push("columna de estado de email como clave");
  if (CONTACTS_WRITE.test(source)) found.push("escritura de email_status sobre contacts");
  if (RPC_CALL.test(source)) found.push("llamada directa a set_email_status");
  return found;
}

describe("el estado de email se escribe solo desde lib/email/subscription.ts", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

  it("el escaneo encuentra archivos de verdad (no pasa en vacio)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith(join("lib", "email", "subscription.ts")))).toBe(true);
  });

  it("ningun otro archivo de aplicacion escribe el estado de email", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (isExcluded(rel) || ALLOWED_FILES.includes(rel) || DECLARES_ONLY.includes(rel)) continue;
      const hits = emailStatusWrites(readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("el modulo permitido efectivamente llama a las funciones de la base", () => {
    const src = readFileSync(join(ROOT, ALLOWED_FILES[0]), "utf8");
    expect(src).toMatch(RPC_CALL);
  });

  it("el control detecta cada forma de escribir (prueba del propio test)", () => {
    expect(emailStatusWrites(`supabase.from("contacts").update({ email_status: "subscribed" })`)).not.toEqual([]);
    expect(emailStatusWrites(`const patch = { email_unsubscribe_token: x }`)).not.toEqual([]);
    expect(emailStatusWrites(`service.rpc("set_email_status_by_address", {})`)).not.toEqual([]);
    expect(emailStatusWrites(`await db.from("contract_signatures").update({ email_status: "sent" })`)).toEqual([]);
    expect(emailStatusWrites(`.select("id, email_status, email_status_at")`)).toEqual([]);
  });
});
