#!/usr/bin/env node
// Comprueba que las migraciones de la plantilla de estudiantes crean EXACTAMENTE la
// base de referencia (todas las migraciones del proyecto + la poda + la limpieza de
// historia), y que no cuentan historia.
//
//   node scripts/verify-student-schema.mjs [--ref-workdir=carpeta] [--work=carpeta]
//                                          [--skip-reference] [--generate] [--keep-template]
//                                          [--history-only]   (solo el paso 2, sin bases)
//
// Pasos:
//   1. La base de referencia (Supabase local en los puertos 553xx): build-reference.mjs
//      (reset + poda + restos + foto), clean-history.mjs, y la foto A.
//      --skip-reference usa la base de referencia tal como esta (ya podada y limpia).
//      --generate vuelve a escribir las migraciones de la plantilla desde la referencia.
//   2. Revisa que las migraciones de la plantilla no cuenten historia (numeros de
//      migracion, fechas, "produccion", PRs, nombres, modulos que no estan...).
//   3. Para la referencia (es nuestra: libera memoria) y levanta otro Supabase local
//      (puertos 556xx, proyecto "plantilla-prueba") con SOLO las migraciones de
//      plantilla-estudiantes/supabase/migrations. Foto B y check-residue.
//   4. Compara A y B linea por linea. Cualquier diferencia hace salir con 1.
//   5. Para la base de la plantilla y vuelve a levantar la de referencia (queda como
//      estaba: podada y limpia).
//
// Nunca toca un proyecto remoto (nada de --linked) ni otro Supabase local.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { findHistory, lexSql, HISTORY_PATTERNS } from "./plantilla/clean-history.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

const refWorkdir = resolve(arg("ref-workdir") ?? join(repo, ".plantilla-work", "ref"));
const work = resolve(arg("work") ?? join(repo, ".plantilla-work"));
const tplWorkdir = join(work, "plantilla");
const REF_DB = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const TPL_DB = "postgresql://postgres:postgres@127.0.0.1:55622/postgres";
const migrationsDir = join(repo, "plantilla-estudiantes", "supabase", "migrations");
const seedsDir = join(repo, "plantilla-estudiantes", "supabase", "seeds");

// Textos de CODIGO que coinciden con un patron de historia y no lo son. No se pueden
// cambiar (la limpieza solo toca comentarios). Cada uno con su motivo.
const CODE_ALLOW = [
  { text: "tiene que ser la publica de produccion",
    reason: "mensaje de error de private.set_system_secret: la URL publica de la app desplegada, no la historia del proyecto" },
];

const env = { ...process.env, PATH: `/Applications/Docker.app/Contents/Resources/bin:${process.env.PATH ?? ""}` };
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}   [${elapsed()}]`);
  return execFileSync(cmd, args, { stdio: "inherit", env, ...opts });
}
const node = (script, ...args) => run("node", [join(here, script), ...args]);
mkdirSync(work, { recursive: true });

// 2 primero: no necesita ninguna base.
const historyHits = checkHistory();
if (flag("history-only")) {
  for (const h of historyHits) console.log(`  ${h}`);
  console.log(historyHits.length ? `\nHistoria: ${historyHits.length}` : "Historia en las migraciones: ninguna.");
  process.exit(historyHits.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// 1. Referencia
// ---------------------------------------------------------------------------
if (!flag("skip-reference")) {
  node("plantilla/build-reference.mjs", `--workdir=${refWorkdir}`);
  node("plantilla/clean-history.mjs", `--db-url=${REF_DB}`);
}
if (flag("generate")) node("plantilla/generate-migrations.mjs", `--db-url=${REF_DB}`);
const snapA = join(work, "foto-referencia.tsv");
node("plantilla/snapshot-schema.mjs", `--db-url=${REF_DB}`, `--out=${snapA}`);
const extraA = await extraSnapshot(REF_DB);

// ---------------------------------------------------------------------------
// 2. Historia en las migraciones
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3. La base de la plantilla
// ---------------------------------------------------------------------------
const TPL_CONFIG = `# Base local de prueba de la plantilla de estudiantes: solo sus migraciones, en
# puertos 556xx para no chocar con la de referencia (553xx) ni con otro stack (543xx).
project_id = "plantilla-prueba"

[api]
enabled = true
port = 55621
schemas = ["public"]

[db]
port = 55622
shadow_port = 55620
major_version = 17

[studio]
enabled = false
port = 55623

[inbucket]
enabled = true
port = 55624

[analytics]
enabled = false
port = 55627

[db.pooler]
enabled = false
port = 55629

[edge_runtime]
enabled = false

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
jwt_expiry = 3600
enable_signup = false
`;
const supaDir = join(tplWorkdir, "supabase");
mkdirSync(supaDir, { recursive: true });
writeFileSync(join(supaDir, "config.toml"), TPL_CONFIG);
const link = join(supaDir, "migrations");
let isLink = false;
try {
  isLink = lstatSync(link).isSymbolicLink();
} catch {
  isLink = false;
}
if (isLink) {
  if (resolve(supaDir, readlinkSync(link)) !== migrationsDir) throw new Error(`${link} apunta a otro lado`);
} else if (existsSync(link)) {
  throw new Error(`${link} existe y no es un enlace a ${migrationsDir}. Borralo y volve a correr.`);
} else {
  symlinkSync(migrationsDir, link);
}

const status = (workdir) => {
  try {
    execFileSync("supabase", ["status", "--workdir", workdir], { stdio: "ignore", env });
    return true;
  } catch {
    return false;
  }
};
let failed = false;
let snapB;
let extraB;
let residueOk = true;
try {
  // La referencia es nuestra: se para para liberar memoria (sus datos quedan en Docker).
  if (status(refWorkdir)) run("supabase", ["stop", "--workdir", refWorkdir]);
  if (!status(tplWorkdir)) run("supabase", ["start", "--workdir", tplWorkdir]);
  run("supabase", ["db", "reset", "--local", "--workdir", tplWorkdir]);
  snapB = join(work, "foto-plantilla.tsv");
  node("plantilla/snapshot-schema.mjs", `--db-url=${TPL_DB}`, `--out=${snapB}`);
  extraB = await extraSnapshot(TPL_DB);
  try {
    node("plantilla/check-residue.mjs", `--db-url=${TPL_DB}`);
  } catch {
    residueOk = false;
  }
} catch (e) {
  failed = true;
  console.error(`\nNo se pudo armar la base de la plantilla: ${e.message}`);
} finally {
  if (!flag("keep-template") && status(tplWorkdir)) run("supabase", ["stop", "--workdir", tplWorkdir]);
  if (!status(refWorkdir)) run("supabase", ["start", "--workdir", refWorkdir]);
}
if (failed) process.exit(1);

// ---------------------------------------------------------------------------
// 4. Comparacion
// ---------------------------------------------------------------------------
const linesOf = (file, extra) => normalize(readFileSync(file, "utf8").split("\n").filter(Boolean)).concat(extra);
const A = linesOf(snapA, extraA);
const B = linesOf(snapB, extraB);
const setA = new Set(A);
const setB = new Set(B);
const onlyA = A.filter((l) => !setB.has(l));
const onlyB = B.filter((l) => !setA.has(l));

console.log(`\n=== Resultado [${elapsed()}]`);
console.log(`Objetos comparados: ${A.length} (referencia) y ${B.length} (plantilla).`);
if (onlyA.length || onlyB.length) {
  console.log(`\nDIFERENCIAS: ${onlyA.length + onlyB.length}`);
  for (const l of onlyA) console.log(`  - solo en la referencia: ${l.slice(0, 400)}`);
  for (const l of onlyB) console.log(`  + solo en la plantilla:  ${l.slice(0, 400)}`);
} else {
  console.log("Diferencias: 0. Las dos bases son iguales.");
}
if (historyHits.length) {
  console.log(`\nHISTORIA en las migraciones de la plantilla: ${historyHits.length}`);
  for (const h of historyHits) console.log(`  ${h}`);
} else {
  console.log("Historia en las migraciones: ninguna.");
}
if (!residueOk) console.log("\ncheck-residue encontro restos en la base de la plantilla.");
process.exit(onlyA.length || onlyB.length || historyHits.length || !residueOk ? 1 : 0);

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

// Lo que la foto de snapshot-schema.mjs no mira y la plantilla igual tiene que crear.
async function extraSnapshot(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const out = [];
  try {
    // Disparadores en tablas de Supabase (auth.users) que llaman a funciones nuestras.
    const { rows: trg } = await client.query(`
      select n.nspname || '.' || c.relname || '.' || t.tgname as k, pg_get_triggerdef(t.oid) as def, t.tgenabled::text as enabled
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname not in ('public', 'private', 'storage')
         and t.tgfoid in (select oid from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace))
       order by 1`);
    for (const r of trg) out.push(`extra_trigger\t${JSON.stringify(r)}`);
    // Comentarios de indices y del esquema private.
    const { rows: cm } = await client.query(`
      select 'index ' || n.nspname || '.' || c.relname as k, md5(d.description) as comment
        from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid = 0
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind = 'i'
      union all
      select 'schema ' || nspname, md5(coalesce(obj_description(oid, 'pg_namespace'), '')) from pg_namespace where nspname = 'private'
       order by 1`);
    for (const r of cm) out.push(`extra_comment\t${JSON.stringify(r)}`);
    // La configuracion del sistema, sin las fechas (son el momento de la instalacion).
    const { rows: cfg } = await client.query(`select key as k, md5(coalesce(description, '')) as description from private.system_config order by 1`);
    for (const r of cfg) out.push(`extra_system_config\t${JSON.stringify(r)}`);
    // Dueno de las tablas (las funciones ya lo tienen en la foto).
    const { rows: own } = await client.query(`
      select n.nspname || '.' || c.relname as k, pg_get_userbyid(c.relowner) as owner
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('r', 'i') order by 1`);
    for (const r of own) out.push(`extra_owner\t${JSON.stringify(r)}`);
  } finally {
    await client.end();
  }
  return out;
}

// La foto guarda la huella de las filas de private.system_config, que tiene la fecha de
// instalacion: esa linea se reemplaza por extra_system_config (sin las fechas).
function normalize(lines) {
  return lines.filter((l) => !l.startsWith('seeded_rows\t{"k":"private.system_config"'));
}

// Busca historia en los comentarios de las migraciones (los `--` de afuera, los de
// adentro del cuerpo de cada funcion y los textos de COMMENT ON) y, en el codigo, los
// patrones que nunca pueden aparecer (numeros de migracion, fechas, nombres...).
function checkHistory() {
  const hits = [];
  const codePatterns = HISTORY_PATTERNS.filter((p) => !["codigo de requerimiento", "modulo sacado"].includes(p.name));
  const files = [
    ...readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => join(migrationsDir, f)),
    ...(existsSync(seedsDir) ? readdirSync(seedsDir).filter((f) => f.endsWith(".sql")).map((f) => join(seedsDir, f)) : []),
  ].sort();
  for (const file of files) {
    const name = file.slice(repo.length + 1);
    const isSeed = file.startsWith(seedsDir);
    const scanComment = (text) => {
      for (const h of findHistory(text)) {
        // En los seeds, la fecha en que se verifico un precio es un dato, no historia.
        if (isSeed && h.rule === "fecha") continue;
        hits.push(`${name}: [${h.rule}] ${h.snippet}`);
      }
    };
    const scanCode = (text) => {
      for (const p of codePatterns) {
        if (isSeed && p.name === "fecha") continue;
        const m = text.match(p.re);
        if (m && CODE_ALLOW.some((a) => text.includes(a.text))) continue;
        if (m) hits.push(`${name}: [${p.name}, en codigo] ${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}`);
      }
    };
    const walk = (src, depth) => {
      const toks = lexSql(src);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.type === "line_comment" || t.type === "block_comment") scanComment(t.text);
        else if (t.type === "dollar" && depth === 0) walk(t.text.slice(t.tag.length, -t.tag.length), 1);
        else if (t.type === "string" || t.type === "estring") {
          const before = toks.slice(Math.max(0, i - 1), i).map((x) => x.text).join("");
          if (/\bIS\s*$/i.test(before)) scanComment(t.text);
          else scanCode(t.text);
        } else if (t.type === "code") scanCode(t.text);
      }
    };
    walk(readFileSync(file, "utf8"), 0);
  }
  return hits;
}
