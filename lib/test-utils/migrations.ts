/**
 * Ayudas para los tests que leen las migraciones de `supabase/migrations/`.
 *
 * Un test que compara el codigo con la base (un CHECK, la lista de permisos del Member, una
 * funcion) tiene que leer la ULTIMA definicion, sin importar en que archivo esta: asi pasa igual
 * en este proyecto (cientos de migraciones, cada cambio en la suya) y en una plantilla que
 * arranca con las migraciones consolidadas por area. Nada de numeros de migracion fijos aca.
 *
 * Los comentarios `--` se sacan antes de buscar: muchas migraciones copian la definicion vieja en
 * su cabecera, comentada, para poder volver atras.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Desde que migracion cada tabla nueva declara sus GRANT (ver `lib/migrations-grants.test.ts`).
 * Las de antes se resuelven con los permisos por defecto de la primera migracion. En una
 * plantilla con las migraciones consolidadas, es la primera que se sume despues de esas.
 */
export const GRANTS_REQUIRED_FROM = 224; // @plantilla-quitar(proyecto)
// @plantilla-sin(proyecto): export const GRANTS_REQUIRED_FROM = 17;

/** La carpeta de las migraciones (la del repo, no la del proceso que corre el test). */
export function migrationsDir(): string {
  return resolve(__dirname, "..", "..", "supabase", "migrations");
}

/** Las migraciones numeradas (`00042_algo.sql`), en el orden en que se aplican. */
export function listMigrations(): string[] {
  return readdirSync(migrationsDir())
    .filter((f) => /^\d{5}_.*\.sql$/.test(f))
    .sort();
}

/** El numero de una migracion (`00042_algo.sql` -> 42). */
export function migrationNumber(file: string): number {
  return Number(file.slice(0, 5));
}

/** El texto de una migracion. */
export function readMigration(file: string): string {
  return readFileSync(join(migrationsDir(), file), "utf8");
}

/** El SQL sin los comentarios `--` (los textos entre comillas que tengan `--` tambien se cortan: no hay). */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

export interface MigrationMatch {
  /** El archivo donde esta la ultima coincidencia. */
  file: string;
  /** La coincidencia entera, con sus grupos. */
  match: RegExpMatchArray;
}

/**
 * La ULTIMA coincidencia de `pattern` en todas las migraciones (sin comentarios), recorriendolas
 * en orden: la que gana en la base. `null` si no hay ninguna.
 */
export function lastDefinition(pattern: RegExp): MigrationMatch | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let found: MigrationMatch | null = null;
  for (const file of listMigrations()) {
    const sql = stripSqlComments(readMigration(file));
    for (const match of sql.matchAll(re)) found = { file, match };
  }
  return found;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * La ultima definicion de una funcion (`"private.member_permission_keys"`, `"public.create_booking"`),
 * desde el `CREATE` hasta el cierre de su cuerpo (`$tag$`). `null` si ninguna migracion la crea.
 */
export function lastFunctionDefinition(qualifiedName: string): { file: string; sql: string } | null {
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escape(qualifiedName)}\\s*\\(`, "gi");
  let found: { file: string; sql: string } | null = null;
  for (const file of listMigrations()) {
    const sql = stripSqlComments(readMigration(file));
    for (const m of sql.matchAll(head)) {
      const start = m.index ?? 0;
      const as = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(sql.slice(start));
      if (!as) continue;
      const bodyStart = start + (as.index ?? 0) + as[0].length;
      const end = sql.indexOf(as[1], bodyStart);
      if (end === -1) continue;
      found = { file, sql: sql.slice(start, end + as[1].length) };
    }
  }
  return found;
}

/** El texto entre el parentesis que abre en `from` y el que lo cierra (sin los dos). */
function balanced(text: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  return null;
}

/**
 * La expresion de la ultima definicion de un CHECK por su nombre, escrito como sea
 * (`ADD CONSTRAINT x CHECK (...)` o `CONSTRAINT x CHECK (...)` adentro del CREATE TABLE).
 */
export function lastCheck(constraintName: string): { file: string; expr: string } | null {
  const re = new RegExp(`CONSTRAINT\\s+${escape(constraintName)}\\s+CHECK\\s*\\(`, "gi");
  let found: { file: string; expr: string } | null = null;
  for (const file of listMigrations()) {
    const sql = stripSqlComments(readMigration(file));
    for (const m of sql.matchAll(re)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const expr = balanced(sql, open);
      if (expr !== null) found = { file, expr };
    }
  }
  return found;
}

/**
 * Los valores de texto que admite un CHECK de lista, en el orden en que estan escritos.
 * Sirve para `col IN ('a', 'b')` y para `col = ANY (ARRAY['a'::text, 'b'::text])`.
 */
export function checkValues(constraintName: string): { file: string; values: string[] } | null {
  const found = lastCheck(constraintName);
  if (!found) return null;
  return { file: found.file, values: [...found.expr.matchAll(/'([^']*)'/g)].map((m) => m[1]) };
}
