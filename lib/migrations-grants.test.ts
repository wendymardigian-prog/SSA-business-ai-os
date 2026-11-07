import { describe, it, expect } from "vitest";
import { GRANTS_REQUIRED_FROM, listMigrations, migrationNumber, readMigration } from "@/lib/test-utils/migrations";

/**
 * Dos cosas que solo se rompen en un Supabase NUEVO (por eso nunca se vieron en
 * la base de produccion, que se armo antes):
 *
 * 1. Los proyectos nuevos de Supabase no le dan acceso automatico a las tablas
 *    de `public` a anon, authenticated y service_role. La primera migracion lo
 *    resuelve (acceso por defecto antes de crear ninguna tabla), y las tablas
 *    nuevas, desde `GRANTS_REQUIRED_FROM`, declaran sus permisos: asi no dependen
 *    de ningun valor por defecto.
 * 2. La CLI (`supabase db push`) no tiene el esquema `extensions` en su
 *    search_path, a diferencia del panel y del conector: un tipo de extension
 *    sin esquema (`vector(1024)`) falla ahi.
 */

const files = listMigrations();

/** El SQL sin comentarios de linea ni de bloque: lo que de verdad se ejecuta. */
function code(file: string): string {
  return readMigration(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

describe("acceso por defecto en un proyecto nuevo (la primera migracion)", () => {
  it("es la primera migracion", () => {
    expect(files[0]).toMatch(/^00000_/);
  });

  it("da acceso por defecto a tablas, secuencias y funciones, a los tres roles", () => {
    const sql = code(files[0]).replace(/\s+/g, " ");
    for (const kind of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
      expect(sql).toContain(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ${kind} TO`);
    }
    expect(sql).toContain("anon, authenticated, service_role");
  });
});

describe("las tablas nuevas declaran sus permisos", () => {
  const recent = files.filter((f) => migrationNumber(f) >= GRANTS_REQUIRED_FROM);

  it.each(recent.length ? recent : [null])("%s", (file) => {
    if (!file) return; // todavia no hay migraciones desde GRANTS_REQUIRED_FROM
    const sql = code(file);
    const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1]);
    for (const table of tables) {
      const grant = new RegExp(
        `grant\\s+[^;]*\\bon\\s+(?:table\\s+)?(?:public\\.)?"?${table}"?\\b[^;]*\\bto\\b[^;]*\\bservice_role\\b`,
        "i",
      );
      expect(
        grant.test(sql),
        `${file}: la tabla ${table} no declara GRANT ... ON ${table} TO service_role (y a authenticated lo que corresponda). ` +
          `Sin eso, en un proyecto sin acceso por defecto la app no puede usarla.`,
      ).toBe(true);
    }
  });
});

describe("anon y authenticated no reciben TRUNCATE, TRIGGER ni REFERENCES", () => {
  // TRUNCATE vacia una tabla sin pasar por la RLS; TRIGGER y REFERENCES dejan crear disparadores y claves foraneas.
  // La app no los usa con la sesion ni con la anon key: se revocaron (00315) y ninguna migracion los vuelve a dar.
  // Los permisos por defecto de la primera migracion (`ALTER DEFAULT PRIVILEGES ... GRANT ALL`) no son una sentencia GRANT.
  // `ON <algo>` que no es funcion, secuencia, esquema, tipo ni dominio: una tabla, con o sin la palabra TABLE.
  const forbidden =
    /^grant\s+(?:all\b|[^;]*\b(?:truncate|trigger|references)\b)[^;]*?\bon\s+(?!(?:function|procedure|routine|sequence|schema|type|domain|all\s+(?:functions|procedures|routines|sequences))\b)[^;]*\bto\b[^;]*\b(?:anon|authenticated|public)\b/i;

  it("el patron reconoce lo que tiene que reconocer", () => {
    expect(forbidden.test("grant all on public.contacts to authenticated")).toBe(true);
    expect(forbidden.test("grant select, truncate on table public.contacts to anon")).toBe(true);
    expect(forbidden.test("grant references on all tables in schema public to authenticated")).toBe(true);
    expect(forbidden.test("grant select, insert on public.contacts to authenticated")).toBe(false);
    expect(forbidden.test("grant all on public.contacts to service_role")).toBe(false);
    expect(forbidden.test("grant all on function public.x() to authenticated")).toBe(false);
  });

  it("ninguna sentencia GRANT se los da sobre una tabla", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const statement of code(file).split(";")) {
        // Sin las listas de columnas: una columna puede llamarse `trigger` (agent_runs.trigger).
        const text = statement.trim().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ");
        if (forbidden.test(text)) offenders.push(`${file}: ${text.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("tipos de extension con esquema", () => {
  it("ninguna migracion escribe vector(N) sin extensions.", () => {
    const offenders = files.filter((f) => /(?<![.\w])vector\s*\(\s*\d+\s*\)/i.test(code(f)));
    expect(offenders).toEqual([]);
  });
});
