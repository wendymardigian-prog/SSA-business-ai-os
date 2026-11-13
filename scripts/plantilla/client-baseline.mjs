// La base consolidada de la plantilla de CLIENTES (BAIOS), en el export.
//
// El proyecto sigue con todas sus migraciones (su base de produccion las tiene anotadas).
// A los clientes, en cambio, les viaja una foto de la base hasta el corte
// (plantilla-clientes/supabase/migrations, la escribe generate-migrations.mjs con
// --perfil=clientes) mas las migraciones del proyecto posteriores al corte, tal cual.
//
// applyClientBaseline arma eso en la copia exportada:
//   1. supabase/migrations = la foto + las migraciones con numero mayor que el corte.
//   2. supabase/historial-migraciones.json: el corte, las versiones de la foto y la lista
//      de las migraciones viejas (version y nombre). La usa scripts/migraciones-compactadas.mjs
//      en la base de un cliente que instalo antes de la foto.
//   3. ALL_MIGRATIONS.sql de nuevo, con lo que quedo en la carpeta.
//   4. Los tests que leen una migracion vieja por su nombre no viajan
//      (CLIENT_EXCLUDED_TESTS); a los que tienen un bloque asi se les saca el bloque
//      marcado como del proyecto (CLIENT_MARKED_TESTS, ver markers.mjs).
//
// Lo usan scripts/export-template.mjs (sin perfil) y scripts/sync-template.mjs.
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { stripMarkers } from "./markers.mjs";
import { DB_PROFILES } from "./db-profiles.mjs";

/** La ultima migracion del proyecto que entra en la foto (incluida). */
export const CLIENT_BASELINE_CUT = 363;
if (DB_PROFILES.clientes.upTo !== CLIENT_BASELINE_CUT) {
  throw new Error("db-profiles.mjs (clientes.upTo) y CLIENT_BASELINE_CUT tienen que ser iguales.");
}

/** Donde vive la foto, en el repo. */
export const CLIENT_BASELINE_DIR = "plantilla-clientes/supabase/migrations";

/** El archivo que la copia de cada cliente lleva con la lista de las migraciones viejas. */
export const HISTORY_FILE = "supabase/historial-migraciones.json";

/**
 * Tests que fijan una migracion vieja por su nombre (lo que cambio una reescritura, un paso
 * de datos o un CHECK de un momento). En la copia de un cliente esos archivos ya no estan:
 * el test no viaja. En el proyecto siguen corriendo. Lo que comprueban lo cubre, para la
 * foto, scripts/verify-template-schema.mjs --perfil=clientes.
 */
export const CLIENT_EXCLUDED_TESTS = [
  "lib/contacts/c2-migrations-diff.test.ts",
  "lib/contacts/c2-migrations-diff.snapshot.json",
  "lib/contacts/find-or-create-migration.test.ts",
  "lib/contacts/record-touch-00215-diff.test.ts",
  "lib/scheduling/booking/create-booking-ad-ids.test.ts",
  "lib/dashboards/chat/core-migration.test.ts",
  "lib/cron/guards.test.ts",
  "lib/eod/migrations.test.ts",
  "lib/finance/default-settings-parity.test.ts",
  "lib/forms/form-versions-lock.test.ts",
  "lib/forms/submit-form-response-diff.test.ts",
  "lib/sales/create-sale-variant-diff.test.ts",
  "lib/sales/submit-form-response-diff.test.ts",
  "lib/sales/automation/triggers-check.test.ts",
  "lib/tasks/migrations.test.ts",
  "lib/webhooks/migrations.test.ts",
  "lib/designer/public/model.test.ts",
];

/**
 * Tests con un bloque que lee una migracion vieja, marcado con
 * `@plantilla-desde(proyecto)` / `@plantilla-quitar(proyecto)`: en la copia se saca solo eso.
 */
export const CLIENT_MARKED_TESTS = [
  "lib/contacts/anonymous.test.ts",
  "lib/content/migrate-copy.test.ts",
  "lib/flows/runs.test.ts",
  "lib/messages/revoke.test.ts",
  "lib/sales/audit.test.ts",
  "lib/sales/fees.test.ts",
  "lib/tasks/audit.test.ts",
  "lib/forms/automation/triggers.test.ts",
  // Sus pruebas de la base consolidada necesitan esta herramienta, que no viaja.
  "scripts/export-template.test.ts",
];

const NUMBERED = /^(\d{5})_(.+)\.sql$/;

/** Las migraciones numeradas de una carpeta: { file, version, name, n }. */
export function numberedMigrations(dir) {
  return readdirSync(dir)
    .flatMap((file) => {
      const m = NUMBERED.exec(file);
      return m ? [{ file, version: m[1], name: m[2], n: Number(m[1]) }] : [];
    })
    .sort((a, b) => a.n - b.n);
}

/** El contenido de historial-migraciones.json, a partir del repo. */
export function historyManifest(repo) {
  const project = numberedMigrations(join(repo, "supabase", "migrations"));
  const baseline = numberedMigrations(join(repo, CLIENT_BASELINE_DIR));
  if (!baseline.length) throw new Error(`No hay foto en ${CLIENT_BASELINE_DIR}: corre generate-migrations.mjs --perfil=clientes.`);
  if (baseline.some((m) => m.n > CLIENT_BASELINE_CUT)) throw new Error("La foto tiene una version mayor que el corte.");
  return {
    corte: String(CLIENT_BASELINE_CUT).padStart(5, "0"),
    foto: baseline.map((m) => m.version),
    historicas: project.filter((m) => m.n <= CLIENT_BASELINE_CUT).map((m) => ({ version: m.version, name: m.name })),
  };
}

/** Lo que la copia trae y el repo no sigue en ese lugar: la foto y la lista de las viejas. */
export function clientBaselineFiles(repo) {
  return [
    ...numberedMigrations(join(repo, CLIENT_BASELINE_DIR)).map((m) => `supabase/migrations/${m.file}`),
    HISTORY_FILE,
  ];
}

/**
 * Arma la base consolidada en la copia exportada `dest`. Devuelve clientBaselineFiles(repo):
 * las rutas (relativas, con "/") que la copia tiene y el repo no sigue en ese lugar.
 */
export function applyClientBaseline({ repo, dest }) {
  const destMigrations = join(dest, "supabase", "migrations");
  const manifest = historyManifest(repo);

  // 1. Fuera las migraciones hasta el corte; adentro la foto.
  for (const m of numberedMigrations(destMigrations)) {
    if (m.n <= CLIENT_BASELINE_CUT) rmSync(join(destMigrations, m.file));
  }
  for (const m of numberedMigrations(join(repo, CLIENT_BASELINE_DIR))) {
    copyFileSync(join(repo, CLIENT_BASELINE_DIR, m.file), join(destMigrations, m.file));
  }

  // 2. La lista de las viejas.
  writeFileSync(join(dest, HISTORY_FILE), JSON.stringify(manifest, null, 2) + "\n");

  // 3. ALL_MIGRATIONS.sql con lo que quedo.
  execFileSync("node", ["scripts/build-all-migrations.mjs"], { cwd: dest, stdio: "pipe" });

  // 4. Los tests de historia.
  for (const rel of CLIENT_EXCLUDED_TESTS) rmSync(join(dest, rel), { force: true });
  for (const rel of CLIENT_MARKED_TESTS) {
    const file = join(dest, rel);
    if (!existsSync(file)) throw new Error(`${rel}: no esta en la copia (la lista CLIENT_MARKED_TESTS quedo vieja).`);
    const before = readFileSync(file, "utf8");
    const after = stripMarkers(before, ["proyecto"]);
    if (after === before) throw new Error(`${rel}: no tiene nada marcado como del proyecto (la lista CLIENT_MARKED_TESTS quedo vieja).`);
    writeFileSync(file, after);
  }
  return clientBaselineFiles(repo);
}
