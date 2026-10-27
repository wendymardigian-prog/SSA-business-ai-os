#!/usr/bin/env node
// Arma la base de referencia de la plantilla de estudiantes, en un Supabase local.
//
//   node scripts/plantilla/build-reference.mjs [--workdir=carpeta] [--no-reset]
//
// La base de referencia es: TODAS las migraciones del proyecto + la poda
// (scripts/plantilla/poda.sql). Es la base que la plantilla tiene que crear con
// sus propias migraciones; su foto (referencia.tsv) es contra lo que despues se
// compara.
//
// Pasos:
//   1. Prepara la carpeta de trabajo (por defecto <repo>/.plantilla-work/ref) con
//      un config.toml propio (puertos 553xx, proyecto "ssa-referencia") y las
//      migraciones del repo enlazadas (no copiadas).
//   2. Levanta el Supabase local si no esta corriendo (necesita Docker).
//   3. `supabase db reset`: borra la base local y aplica todas las migraciones.
//   4. Aplica la poda.
//   5. Corre check-residue.mjs (si encuentra restos, se corta aca).
//   6. Saca la foto con snapshot-schema.mjs en <carpeta>/../referencia.tsv.
//
// Nunca toca un proyecto remoto: todo es local (no usa --linked).
// La carpeta .plantilla-work tiene que estar en .gitignore.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

const workdir = resolve(arg("workdir") ?? join(repo, ".plantilla-work", "ref"));
const DB_PORT = 55322;
const dbUrl = `postgresql://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;
const snapshotOut = join(dirname(workdir), "referencia.tsv");

// El CLI de Supabase necesita encontrar `docker`: en macOS viene adentro de Docker Desktop.
const env = { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH ?? ""}` };

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", env, ...opts });
}

// Mismos puertos y proyecto que la base de referencia de siempre: si ya esta
// corriendo (con esta u otra carpeta de trabajo), se reusa. No choca con otro
// Supabase local que use los puertos de fabrica (543xx).
const CONFIG = `# Base de referencia local para la plantilla de estudiantes: todas las
# migraciones del proyecto, en puertos 553xx para no chocar con otro stack.
project_id = "ssa-referencia"

[api]
enabled = true
port = 55321
schemas = ["public"]

[db]
port = ${DB_PORT}
shadow_port = 55320
major_version = 17

[studio]
enabled = false
port = 55323

[inbucket]
enabled = true
port = 55324

[analytics]
enabled = false
port = 55327

[db.pooler]
enabled = false
port = 55329

[edge_runtime]
enabled = false

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
jwt_expiry = 3600
enable_signup = false
`;

// 1. La carpeta de trabajo.
const supaDir = join(workdir, "supabase");
mkdirSync(supaDir, { recursive: true });
writeFileSync(join(supaDir, "config.toml"), CONFIG);
const migrationsLink = join(supaDir, "migrations");
const migrationsTarget = join(repo, "supabase", "migrations");
if (existsSync(migrationsLink) || isBrokenLink(migrationsLink)) {
  const st = lstatSync(migrationsLink);
  if (!st.isSymbolicLink() || resolve(supaDir, readlinkSync(migrationsLink)) !== migrationsTarget) {
    console.error(`${migrationsLink} existe y no es un enlace a ${migrationsTarget}. Borralo y volve a correr.`);
    process.exit(1);
  }
} else {
  symlinkSync(migrationsTarget, migrationsLink);
}
console.log(`Carpeta de trabajo: ${workdir}`);

function isBrokenLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

// 2. El Supabase local.
let running = true;
try {
  execFileSync("supabase", ["status", "--workdir", workdir], { stdio: "ignore", env });
} catch {
  running = false;
}
if (!running) run("supabase", ["start", "--workdir", workdir]);

// 3. Todas las migraciones desde cero.
if (!flag("no-reset")) run("supabase", ["db", "reset", "--local", "--workdir", workdir]);

// 4. La poda (en una sola transaccion: si algo falla, no queda a medias).
run("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(here, "poda.sql")], { stdio: ["ignore", "ignore", "inherit"] });
console.log("Poda aplicada.");

// 5. Restos de los modulos.
try {
  run("node", [join(here, "check-residue.mjs"), `--db-url=${dbUrl}`]);
} catch {
  console.error("\nQuedaron restos de los modulos: la referencia NO es valida. Corregi poda.sql (o la lista de permitidos).");
  process.exit(1);
}

// 6. La foto.
run("node", [join(here, "snapshot-schema.mjs"), `--db-url=${dbUrl}`, `--out=${snapshotOut}`]);
console.log(`\nListo. Base de referencia en ${dbUrl} (podada) y su foto en ${snapshotOut}.`);
