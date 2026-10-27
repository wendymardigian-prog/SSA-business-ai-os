#!/usr/bin/env node
// Escribe las migraciones de la plantilla de estudiantes a partir de la base de referencia.
//
//   node scripts/plantilla/generate-migrations.mjs [--db-url=postgresql://...] [--out=carpeta] [--check]
//
// La base de referencia es la que arma build-reference.mjs (todas las migraciones del
// proyecto + la poda), ya limpia de historia con clean-history.mjs. Este script lee su
// catalogo y escribe, en plantilla-estudiantes/supabase/:
//   - migrations/00000_permisos_por_defecto.sql y un archivo por area (scripts/plantilla/areas.mjs);
//   - seeds/ (copia de supabase/seeds, con los comentarios limpios);
//   - config.toml (copia de supabase/config.toml con su propio project_id).
//
// Cada objeto nace en su forma final: la tabla con todas sus columnas y restricciones,
// cada funcion con su texto de hoy. Nada se crea para cambiarlo despues. La unica
// excepcion es una clave foranea hacia una tabla de un area posterior: se declara con
// ALTER TABLE ... ADD CONSTRAINT en el area de esa tabla, apenas existe.
//
// Lo que el script NO hace: inventar nombres. Toda restriccion, indice, politica y
// disparador sale con el nombre que tiene en la base de referencia, y los permisos se
// escriben para que queden exactamente iguales (scripts/verify-student-schema.mjs lo
// comprueba comparando las dos bases objeto por objeto).
//
// --check: solo revisa (cada objeto con su area, el orden entre areas) y no escribe.
import pg from "pg";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, OVERRIDES } from "./areas.mjs";
import { lexSql, stripComments, cleanComment } from "./clean-history.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name) => process.argv.includes(`--${name}`);

const dbUrl = arg("db-url") ?? "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const outDir = resolve(arg("out") ?? join(repo, "plantilla-estudiantes", "supabase"));
const checkOnly = flag("check");
const SCHEMAS = ["public", "private"];
const APP_ROLES = ["anon", "authenticated", "service_role"];

// Extensiones que crea el sistema (las demas ya vienen con Supabase). Se escriben igual
// que en el proyecto: pg_cron y pg_net en su esquema de fabrica.
const EXTENSIONS = [
  { name: "supabase_vault", schema: "vault" },
  { name: "pg_cron", schema: null },
  { name: "pg_net", schema: null },
  { name: "vector", schema: "extensions" },
  { name: "btree_gist", schema: "extensions" },
];

// Filas que el sistema necesita desde el primer dia. Las columnas de `now` se escriben
// con now() (el momento de la instalacion), no con el valor de la base de referencia.
const SEEDS = {
  "private.system_config": { conflict: "key", now: { value: "now()::text", updated_at: null } },
};

// Los seeds: solo cambian sus comentarios, con las mismas reglas que la base mas estas
// reescrituras puntuales (texto exacto; si alguna no se encuentra, el script se corta).
const SEED_REWRITES = {
  "00_model_pricing.sql": [
    [
      "-- DATOS, no estructura: por eso vive fuera de supabase/migrations y no entra en\n-- ALL_MIGRATIONS.sql. Correr a mano en el SQL editor de Supabase DESPUES de\n-- aplicar la 00059.",
      "-- DATOS, no estructura: por eso vive fuera de supabase/migrations. Correr a mano\n-- en el SQL editor de Supabase, despues de aplicar las migraciones.",
    ],
    [
      "-- Modelos Anthropic que faltaban — verificado el 2026-09-28",
      "-- Mas modelos de Anthropic — verificado el 2026-09-28",
    ],
    [
      "-- El catalogo de la app tenia tres modelos de Anthropic y quedo viejo. Estos\n-- son los que se sumaron. Fila nueva con `valid_from` nuevo, no se pisa la\n-- anterior: los runs viejos conservan el costo con el que se congelaron.",
      "-- Los demas modelos de Anthropic del catalogo de la app. Fila nueva con\n-- `valid_from` nuevo, no se pisa la anterior: los runs viejos conservan el costo\n-- con el que se congelaron.",
    ],
  ],
  "01_transcription_pricing.sql": [
    [
      "-- DATOS, no estructura: igual que 00_model_pricing.sql, vive fuera de\n-- supabase/migrations y no entra en ALL_MIGRATIONS.sql. Correr a mano en el SQL\n-- editor DESPUES de aplicar la 00103.",
      "-- DATOS, no estructura: igual que 00_model_pricing.sql, vive fuera de\n-- supabase/migrations. Correr a mano en el SQL editor de Supabase, despues de\n-- aplicar las migraciones.",
    ],
  ],
};
// El contenido de 00000: el mismo bloque DO del proyecto (los permisos por defecto).
const DEFAULT_PRIVILEGES_SQL = (() => {
  const src = readFileSync(join(repo, "supabase", "migrations", "00000_default_privileges.sql"), "utf8");
  const at = src.indexOf("DO $$");
  if (at === -1) throw new Error("00000_default_privileges.sql no tiene el bloque DO");
  return src.slice(at).trimEnd() + "\n";
})();

const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const lit = (s) => (s === null || s === undefined ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
const die = (msg) => {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
};

function areaIndexOf(name, list) {
  for (let i = 0; i < AREAS.length; i++) {
    for (const m of AREAS[i][list] ?? []) {
      if (m instanceof RegExp ? m.test(name) : m === name) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Lectura del catalogo
// ---------------------------------------------------------------------------
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
// Con search_path vacio, todo lo que devuelve Postgres (tipos, expresiones, definiciones)
// sale con su esquema: extensions.vector(1024), public.contacts, etc.
await client.query("set search_path = ''");
const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const tables = await q(
  `select c.oid::int as oid, n.nspname as schema, c.relname as name, c.relkind::text as kind,
          quote_ident(n.nspname) || '.' || quote_ident(c.relname) as qname,
          c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, c.relreplident::text as replident,
          c.reloptions, c.relpersistence::text as persistence, obj_description(c.oid, 'pg_class') as comment,
          c.reltype::int as rowtype
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    order by 2, 3`,
  [SCHEMAS],
);
for (const t of tables) {
  if (t.kind !== "r") die(`${t.schema}.${t.name}: tipo de relacion '${t.kind}' no soportado (solo tablas comunes).`);
  if (t.reloptions || t.persistence !== "p") die(`${t.schema}.${t.name}: opciones de tabla no soportadas (${t.reloptions}, ${t.persistence}).`);
  if (t.replident !== "d") die(`${t.schema}.${t.name}: REPLICA IDENTITY '${t.replident}' no soportada.`);
}
const tableByOid = new Map(tables.map((t) => [t.oid, t]));
const tableOids = tables.map((t) => t.oid);
const tableByRowtype = new Map(tables.map((t) => [t.rowtype, t]));

const columns = await q(
  `select a.attrelid::int as rel, a.attnum, quote_ident(a.attname) as qname, a.attname as name,
          format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null,
          a.attidentity::text as identity, a.attgenerated::text as generated,
          pg_get_expr(d.adbin, d.adrelid) as expr, col_description(a.attrelid, a.attnum) as comment,
          (a.attcollation <> t.typcollation) as custom_collation
     from pg_attribute a join pg_type t on t.oid = a.atttypid
     left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = any($1) and a.attnum > 0 and not a.attisdropped
    order by a.attrelid, a.attnum`,
  [tableOids],
);
for (const c of columns) {
  if (c.identity) die(`Columna ${c.name}: identity no soportada.`);
  if (c.custom_collation) die(`Columna ${c.name}: collation propia no soportada.`);
}

const tableAcl = await q(
  `select c.oid::int as rel, case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
          x.privilege_type as priv
     from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where c.oid = any($1)`,
  [tableOids],
);
const columnAcl = await q(
  `select a.attrelid::int as rel, a.attnum, quote_ident(a.attname) as col,
          case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee, x.privilege_type as priv
     from pg_attribute a, aclexplode(a.attacl) x
    where a.attrelid = any($1) and a.attacl is not null and a.attnum > 0 and not a.attisdropped
    order by a.attrelid, a.attnum`,
  [tableOids],
);

const constraints = await q(
  `select con.oid::int as oid, con.conrelid::int as rel, quote_ident(con.conname) as qname, con.conname as name,
          con.contype::text as type, pg_get_constraintdef(con.oid) as def, con.confrelid::int as ref,
          (select relname from pg_class where oid = con.conindid) as index_name
     from pg_constraint con
    where con.conrelid = any($1)
    order by con.conrelid, array_position(array['p','u','x','c','f','t'], con.contype::text), con.conname`,
  [tableOids],
);
for (const c of constraints) {
  if (c.type === "t") die(`Restriccion ${c.name}: constraint trigger no soportado.`);
  if (["p", "u", "x"].includes(c.type) && c.index_name !== c.name) {
    die(`Restriccion ${c.name}: su indice se llama ${c.index_name} (tienen que llamarse igual).`);
  }
}

const indexes = await q(
  `select i.indexrelid::int as oid, i.indrelid::int as rel, ic.relname as name,
          quote_ident(n.nspname) || '.' || quote_ident(ic.relname) as qname,
          pg_get_indexdef(i.indexrelid) as def, obj_description(i.indexrelid, 'pg_class') as comment
     from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_namespace n on n.oid = ic.relnamespace
    where i.indrelid = any($1)
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.contype in ('p', 'u', 'x'))
    order by 3`,
  [tableOids],
);

const functions = await q(
  `select p.oid::int as oid, n.nspname as schema, p.proname as name,
          quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
          n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as key,
          pg_get_functiondef(p.oid) as def, l.lanname as lang, p.prokind::text as kind, p.prosrc as src,
          p.prosqlbody is not null as atomic, pg_get_userbyid(p.proowner) as owner,
          obj_description(p.oid, 'pg_proc') as comment
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = any($1) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 2, 3, 4`,
  [SCHEMAS],
);
const fnByOid = new Map(functions.map((f) => [f.oid, f]));
const fnOids = functions.map((f) => f.oid);
for (const f of functions) {
  if (f.owner !== "postgres") die(`Funcion ${f.key}: su duenio es ${f.owner} (se esperaba postgres).`);
  if (f.kind !== "f" && f.kind !== "p") die(`Funcion ${f.key}: tipo '${f.kind}' no soportado.`);
}
const fnAcl = await q(
  `select p.oid::int as fn, case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
          x.privilege_type as priv
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    where p.oid = any($1)`,
  [fnOids],
);

const triggers = await q(
  `select t.oid::int as oid, t.tgrelid::int as rel, n.nspname as schema, c.relname as tbl, t.tgname as name,
          pg_get_triggerdef(t.oid) as def, t.tgenabled::text as enabled, t.tgfoid::int as fn,
          quote_ident(n.nspname) || '.' || quote_ident(c.relname) as qtable, quote_ident(t.tgname) as qname
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and (t.tgrelid = any($1) or t.tgfoid = any($2))
    order by 3, 4, 5`,
  [tableOids, fnOids],
);

const policies = await q(
  `select pol.oid::int as oid, pol.polrelid::int as rel, n.nspname as schema, c.relname as tbl, pol.polname as name,
          quote_ident(pol.polname) as qname, quote_ident(n.nspname) || '.' || quote_ident(c.relname) as qtable,
          p.permissive, p.cmd, p.qual, p.with_check,
          (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ' order by r) from unnest(p.roles) r) as roles
     from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
     join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname and p.policyname = pol.polname
    where n.nspname = any($1) or (n.nspname = 'storage' and c.relname = 'objects')
    order by 3, 4, 5`,
  [SCHEMAS],
);

const deps = await q(
  `select d.classid::regclass::text as cls, d.objid::int as objid, d.objsubid,
          d.refclassid::regclass::text as refcls, d.refobjid::int as refobjid
     from pg_depend d
    where d.deptype in ('n', 'a')
      and d.refclassid in ('pg_proc'::regclass, 'pg_class'::regclass, 'pg_type'::regclass)
      and (d.refobjid = any($1) or d.refobjid = any($2) or d.refobjid in (select reltype from pg_class where oid = any($1))
           or d.refobjid in (select typarray from pg_type t join pg_class c on c.reltype = t.oid where c.oid = any($1)))`,
  [tableOids, fnOids],
);
const attrdefs = await q(`select oid::int, adrelid::int as rel from pg_attrdef where adrelid = any($1)`, [tableOids]);
const attrdefRel = new Map(attrdefs.map((a) => [a.oid, a.rel]));
const arrayTypes = await q(
  `select t.typarray::int as arr, c.oid::int as rel from pg_class c join pg_type t on t.oid = c.reltype where c.oid = any($1)`,
  [tableOids],
);
const tableByArrayType = new Map(arrayTypes.map((a) => [a.arr, tableByOid.get(a.rel)]));

const cronJobs = await q(`select jobname, schedule, command, active from cron.job order by jobname`);
const buckets = await q(
  `select id, name, public, file_size_limit, allowed_mime_types, owner, avif_autodetection
     from storage.buckets order by id`,
);
const realtime = await q(
  `select pt.schemaname as schema, pt.tablename as tbl, pr.prattrs is null as all_cols, pr.prqual is null as no_filter
     from pg_publication_tables pt
     join pg_publication p on p.pubname = pt.pubname
     join pg_class c on c.relname = pt.tablename join pg_namespace n on n.oid = c.relnamespace and n.nspname = pt.schemaname
     join pg_publication_rel pr on pr.prpubid = p.oid and pr.prrelid = c.oid
    where pt.pubname = 'supabase_realtime' order by 1, 2`,
);
for (const r of realtime) if (!r.all_cols || !r.no_filter) die(`realtime ${r.tbl}: lista de columnas o filtro no soportados.`);

const extensions = await q(`select e.extname as name, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace`);
const types = await q(
  `select n.nspname || '.' || t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = any($1) and t.typtype in ('e', 'd', 'r', 'm') or (n.nspname = any($1) and t.typtype = 'c' and t.typrelid not in (select oid from pg_class where relkind <> 'c'))`,
  [SCHEMAS],
);
if (types.length) die(`Tipos propios no soportados: ${types.map((t) => t.name).join(", ")}`);
const seqs = await q(`select schemaname || '.' || sequencename as name from pg_sequences where schemaname = any($1)`, [SCHEMAS]);
if (seqs.length) die(`Secuencias no soportadas: ${seqs.map((s) => s.name).join(", ")}`);
const schemaInfo = await q(
  `select n.nspname as name, pg_get_userbyid(n.nspowner) as owner, obj_description(n.oid, 'pg_namespace') as comment,
          (select string_agg(x.grantee::regrole::text || ':' || x.privilege_type, ',' order by 1)
             from aclexplode(n.nspacl) x where x.grantee <> n.nspowner) as grants
     from pg_namespace n where n.nspname = 'private'`,
);

const seedRows = {};
for (const t of Object.keys(SEEDS)) {
  const [schema, name] = t.split(".");
  const cols = columns.filter((c) => c.rel === tables.find((x) => x.schema === schema && x.name === name).oid);
  const rows = await q(`select * from ${t} order by 1`);
  seedRows[t] = { cols, rows };
}
// Toda tabla con filas tiene que estar en SEEDS (si no, la plantilla no la reproduce).
for (const t of tables) {
  const { rows } = await client.query(`select count(*)::int as n from ${t.qname}`);
  if (rows[0].n > 0 && !SEEDS[`${t.schema}.${t.name}`]) die(`${t.schema}.${t.name} tiene ${rows[0].n} filas y no esta en SEEDS.`);
}
await client.end();

// ---------------------------------------------------------------------------
// Areas de tablas y funciones
// ---------------------------------------------------------------------------
const problems = [];
for (const t of tables) {
  t.area = areaIndexOf(`${t.schema}.${t.name}`, "tables");
  if (t.area < 0) problems.push(`tabla ${t.schema}.${t.name} sin area`);
}
for (const f of functions) {
  f.area = areaIndexOf(`${f.schema}.${f.name}`, "functions");
  if (f.area < 0) problems.push(`funcion ${f.schema}.${f.name} sin area`);
}
for (const area of AREAS) {
  for (const list of ["tables", "functions"]) {
    for (const m of area[list] ?? []) {
      const pool = list === "tables" ? tables : functions;
      const hit = pool.some((o) => (m instanceof RegExp ? m.test(`${o.schema}.${o.name}`) : m === `${o.schema}.${o.name}`));
      if (!hit) problems.push(`${area.file}: "${m}" no existe en la base de referencia`);
    }
  }
}
if (problems.length) die("Objetos sin area o nombres que no existen:\n  " + problems.join("\n  "));

const extArea = AREAS.findIndex((a) => a.extensions);
const cronArea = AREAS.findIndex((a) => a.cron);
const bucketArea = AREAS.findIndex((a) => a.buckets);

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------
// Nodos: tabla, fk (alter), funcion, indice, disparador, politica, realtime, semilla, bucket, cron.
const nodes = new Map(); // id -> { id, kind, area, deps:Set, sql, name }
const KIND_RANK = { ext: 0, schema: 1, table: 2, fk: 3, function: 4, index: 5, trigger: 6, policy: 7, realtime: 8, seed: 9, bucket: 2, cron: 11 };
const addNode = (n) => {
  n.deps = n.deps ?? new Set();
  nodes.set(n.id, n);
  return n;
};
const tid = (oid) => `table:${oid}`;
const fid = (oid) => `function:${oid}`;

// Dependencias de catalogo por objeto (pg_depend), resueltas a nodos.
function refNode(d) {
  if (d.refcls === "pg_proc" && fnByOid.has(d.refobjid)) return fid(d.refobjid);
  if (d.refcls === "pg_class" && tableByOid.has(d.refobjid)) return tid(d.refobjid);
  if (d.refcls === "pg_type") {
    const t = tableByRowtype.get(d.refobjid) ?? tableByArrayType.get(d.refobjid);
    if (t) return tid(t.oid);
  }
  return null;
}
const depsOf = new Map(); // "cls:objid" -> Set(nodeId)
for (const d of deps) {
  const r = refNode(d);
  if (!r) continue;
  let key = `${d.cls}:${d.objid}`;
  if (d.cls === "pg_attrdef") key = `pg_class:${attrdefRel.get(d.objid)}`; // un default es de su tabla
  if (!depsOf.has(key)) depsOf.set(key, new Set());
  depsOf.get(key).add(r);
}
const catalogDeps = (cls, oid) => depsOf.get(`${cls}:${oid}`) ?? new Set();

// Dependencias de texto de una funcion: lo que Postgres valida al crearla.
//  - SQL (cuerpo entre comillas): las tablas y funciones que nombra.
//  - plpgsql: los tipos de la seccion DECLARE (tabla%ROWTYPE, tabla.col%TYPE, variable tabla).
const tableNames = new Map(tables.map((t) => [`${t.schema}.${t.name}`, t]));
const fnNames = new Map();
for (const f of functions) {
  const k = `${f.schema}.${f.name}`;
  if (!fnNames.has(k)) fnNames.set(k, []);
  fnNames.get(k).push(f);
}
function codeOnly(src) {
  return lexSql(src)
    .filter((t) => t.type === "code" || t.type === "ident")
    .map((t) => (t.type === "ident" ? t.text.slice(1, -1) : t.text))
    .join(" ");
}
function textDeps(f) {
  const out = new Set();
  if (f.atomic) return out; // BEGIN ATOMIC: pg_depend ya las tiene
  const code = codeOnly(f.src).toLowerCase();
  const resolveTable = (schema, name) => tableNames.get(`${schema ?? "public"}.${name}`);
  if (f.lang === "sql") {
    for (const m of code.matchAll(/\b(?:from|join|update|into|table|using)\s+(?:only\s+)?(?:(public|private)\s*\.\s*)?([a-z_][a-z0-9_]*)/g)) {
      const t = resolveTable(m[1], m[2]);
      if (t) out.add(tid(t.oid));
    }
    for (const m of code.matchAll(/\b(?:(public|private)\s*\.\s*)?([a-z_][a-z0-9_]*)\s*\(/g)) {
      for (const g of fnNames.get(`${m[1] ?? "public"}.${m[2]}`) ?? []) if (g.oid !== f.oid) out.add(fid(g.oid));
    }
  } else if (f.lang === "plpgsql") {
    const decl = /\bdeclare\b([\s\S]*?)\bbegin\b/.exec(code);
    if (decl) {
      for (const m of decl[1].matchAll(/(?:(public|private)\s*\.\s*)?([a-z_][a-z0-9_]*)(?:\s*\.\s*[a-z_][a-z0-9_]*)?\s*%\s*(?:row)?type/g)) {
        const t = resolveTable(m[1], m[2]);
        if (t) out.add(tid(t.oid));
      }
      for (const m of decl[1].matchAll(/(?:^|;)\s*[a-z_][a-z0-9_]*\s+(?:constant\s+)?(?:(public|private)\s*\.\s*)?([a-z_][a-z0-9_]*)\s*(?:\[\s*\])?\s*(?:;|:=|default|not\b)/g)) {
        const t = resolveTable(m[1], m[2]);
        if (t) out.add(tid(t.oid));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL de cada objeto
// ---------------------------------------------------------------------------
const commentSql = (kind, target, text) => (text ? `COMMENT ON ${kind} ${target} IS ${lit(text)};` : null);

// Permisos: lo que deja la creacion (con los permisos por defecto de la 00000) contra lo
// que tiene la base de referencia. Se escribe solo la diferencia.
function defaultTablePrivs(schema) {
  const m = new Map();
  for (const r of [...APP_ROLES, "PUBLIC"]) m.set(r, new Set(schema === "public" && r !== "PUBLIC" ? TABLE_PRIVS : []));
  return m;
}
function defaultFnPrivs(schema) {
  const m = new Map();
  m.set("PUBLIC", new Set(["EXECUTE"]));
  for (const r of APP_ROLES) m.set(r, new Set(schema === "public" ? ["EXECUTE"] : []));
  return m;
}
function aclStatements(objKind, target, defaults, actual) {
  // actual: Map role -> Set(privs) (solo PUBLIC y los tres roles de la app)
  const revokes = new Map();
  const grants = new Map();
  for (const role of ["PUBLIC", ...APP_ROLES]) {
    const want = actual.get(role) ?? new Set();
    const have = defaults.get(role) ?? new Set();
    const rm = [...have].filter((p) => !want.has(p));
    const add = [...want].filter((p) => !have.has(p));
    const fullSet = objKind === "TABLE" ? TABLE_PRIVS : ["EXECUTE"];
    if (rm.length) {
      const k = rm.length === have.size && have.size === fullSet.length ? "ALL" : order(rm, fullSet).join(", ");
      revokes.set(k, [...(revokes.get(k) ?? []), role]);
    }
    if (add.length) {
      const k = add.length === fullSet.length && objKind === "TABLE" ? "ALL" : order(add, fullSet).join(", ");
      grants.set(k, [...(grants.get(k) ?? []), role]);
    }
  }
  const out = [];
  for (const [privs, roles] of revokes) out.push(`REVOKE ${privs} ON ${objKind} ${target} FROM ${roles.join(", ")};`);
  for (const [privs, roles] of grants) out.push(`GRANT ${privs} ON ${objKind} ${target} TO ${roles.join(", ")};`);
  return out;
}
// Un `x BETWEEN a AND b` queda guardado como ((x >= a) AND (x <= b)). Escrito asi, como
// primer operando de otro AND, Postgres lo aplana al leerlo y la restriccion queda con
// otra forma. Volver a escribirlo con BETWEEN da exactamente la misma expresion.
function restoreBetween(def) {
  return def.replace(/\(\(([\w"]+) >= ([^()]+?)\) AND \(\1 <= ([^()]+?)\)\)(?= AND )/g, "($1 BETWEEN $2 AND $3)");
}
const order = (list, ref) => [...list].sort((a, b) => ref.indexOf(a) - ref.indexOf(b));
function aclMap(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.grantee !== "PUBLIC" && !APP_ROLES.includes(r.grantee)) continue;
    if (!m.has(r.grantee)) m.set(r.grantee, new Set());
    m.get(r.grantee).add(r.priv);
  }
  return m;
}

// --- Claves foraneas: en linea o aparte -----------------------------------------
const fksByTable = new Map();
for (const c of constraints.filter((c) => c.type === "f")) {
  if (!fksByTable.has(c.rel)) fksByTable.set(c.rel, []);
  fksByTable.get(c.rel).push(c);
}
// Una FK hacia una tabla nuestra de un area posterior, o que cierra un ciclo dentro de
// la misma area, va aparte. Para los ciclos: dentro de un area, las tablas se ordenan
// por su posicion en la lista de areas.mjs; una FK hacia una tabla que va despues en
// esa lista va aparte, salvo que apunte a si misma.
const tablePos = new Map();
for (const t of tables) {
  const list = AREAS[t.area].tables;
  tablePos.set(t.oid, list.indexOf(`${t.schema}.${t.name}`));
}
const separateFk = new Set();
for (const c of constraints.filter((c) => c.type === "f")) {
  const owner = tableByOid.get(c.rel);
  const ref = tableByOid.get(c.ref);
  if (!ref || ref.oid === owner.oid) continue; // auth.users u otra tabla de Supabase, o si misma
  if (ref.area > owner.area) separateFk.add(c.oid);
  else if (ref.area === owner.area && tablePos.get(ref.oid) > tablePos.get(owner.oid)) separateFk.add(c.oid);
}

// --- Tablas ---------------------------------------------------------------------
for (const t of tables) {
  const cols = columns.filter((c) => c.rel === t.oid);
  const lines = [];
  for (const c of cols) {
    let s = `  ${c.qname} ${c.type}`;
    if (c.generated === "s") s += ` GENERATED ALWAYS AS (${c.expr}) STORED`;
    else if (c.expr !== null) s += ` DEFAULT ${c.expr}`;
    if (c.not_null) s += " NOT NULL";
    lines.push(s);
  }
  const cons = constraints.filter((c) => c.rel === t.oid && !separateFk.has(c.oid));
  for (const c of cons) lines.push(`  CONSTRAINT ${c.qname} ${c.type === "c" ? restoreBetween(c.def) : c.def}`);
  const parts = [`CREATE TABLE IF NOT EXISTS ${t.qname} (\n${lines.join(",\n")}\n);`];
  if (t.rls) parts.push(`ALTER TABLE ${t.qname} ENABLE ROW LEVEL SECURITY;`);
  if (t.force_rls) parts.push(`ALTER TABLE ${t.qname} FORCE ROW LEVEL SECURITY;`);
  const comments = [commentSql("TABLE", t.qname, t.comment)];
  for (const c of cols) comments.push(commentSql("COLUMN", `${t.qname}.${c.qname}`, c.comment));
  parts.push(...comments.filter(Boolean));
  const acl = aclStatements("TABLE", t.qname, defaultTablePrivs(t.schema), aclMap(tableAcl.filter((a) => a.rel === t.oid)));
  // Permisos por columna (cuando la tabla no da el permiso entero).
  const colGrants = new Map();
  for (const a of columnAcl.filter((a) => a.rel === t.oid && (a.grantee === "PUBLIC" || APP_ROLES.includes(a.grantee)))) {
    const k = `${a.priv}|${a.grantee}`;
    if (!colGrants.has(k)) colGrants.set(k, []);
    colGrants.get(k).push(a.col);
  }
  for (const [k, cs] of [...colGrants].sort()) {
    const [priv, role] = k.split("|");
    acl.push(`GRANT ${priv} (${cs.join(", ")}) ON TABLE ${t.qname} TO ${role};`);
  }
  parts.push(...acl);
  const d = new Set(catalogDeps("pg_class", t.oid));
  for (const c of cons) {
    for (const x of catalogDeps("pg_constraint", c.oid)) d.add(x);
    if (c.type === "f" && tableByOid.has(c.ref) && c.ref !== t.oid) d.add(tid(c.ref));
  }
  d.delete(tid(t.oid));
  addNode({ id: tid(t.oid), kind: "table", area: t.area, name: `${t.schema}.${t.name}`, sql: parts.join("\n"), deps: d });
}
for (const c of constraints.filter((c) => separateFk.has(c.oid))) {
  const owner = tableByOid.get(c.rel);
  const ref = tableByOid.get(c.ref);
  const sql =
    `DO $$ BEGIN\n  ALTER TABLE ${owner.qname} ADD CONSTRAINT ${c.qname} ${c.def};\n` +
    `EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  addNode({
    id: `fk:${c.oid}`,
    kind: "fk",
    area: Math.max(owner.area, ref.area),
    name: `${owner.name}.${c.name}`,
    sql,
    deps: new Set([tid(owner.oid), tid(ref.oid)]),
  });
}

// --- Funciones ------------------------------------------------------------------
for (const f of functions) {
  const parts = [f.def.trimEnd() + ";"];
  const c = commentSql("FUNCTION", f.sig, f.comment);
  if (c) parts.push(c);
  parts.push(...aclStatements("FUNCTION", f.sig, defaultFnPrivs(f.schema), aclMap(fnAcl.filter((a) => a.fn === f.oid))));
  const d = new Set([...catalogDeps("pg_proc", f.oid), ...textDeps(f)]);
  d.delete(fid(f.oid));
  addNode({ id: fid(f.oid), kind: "function", area: f.area, name: f.key, sql: parts.join("\n"), deps: d });
}

// --- Indices --------------------------------------------------------------------
for (const i of indexes) {
  const t = tableByOid.get(i.rel);
  const d = new Set([tid(t.oid), ...catalogDeps("pg_class", i.oid)]);
  d.delete(`table:${i.oid}`);
  const def = i.def.replace(/^CREATE (UNIQUE )?INDEX /, (_m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS `);
  const parts = [def + ";"];
  const c = commentSql("INDEX", i.qname, i.comment);
  if (c) parts.push(c);
  addNode({ id: `index:${i.oid}`, kind: "index", name: i.name, sql: parts.join("\n"), deps: d });
}

// --- Disparadores ---------------------------------------------------------------
for (const tr of triggers) {
  if (!/^CREATE TRIGGER /.test(tr.def)) die(`Disparador ${tr.name}: definicion no soportada (${tr.def.slice(0, 40)}).`);
  const parts = [tr.def.replace(/^CREATE TRIGGER /, "CREATE OR REPLACE TRIGGER ") + ";"];
  const en = { O: null, D: "DISABLE TRIGGER", R: "ENABLE REPLICA TRIGGER", A: "ENABLE ALWAYS TRIGGER" }[tr.enabled];
  if (en) parts.push(`ALTER TABLE ${tr.qtable} ${en} ${tr.qname};`);
  const d = new Set([...catalogDeps("pg_trigger", tr.oid)]);
  if (tableByOid.has(tr.rel)) d.add(tid(tr.rel));
  if (fnByOid.has(tr.fn)) d.add(fid(tr.fn));
  addNode({ id: `trigger:${tr.oid}`, kind: "trigger", name: `${tr.schema}.${tr.tbl}.${tr.name}`, sql: parts.join("\n"), deps: d });
}

// --- Politicas ------------------------------------------------------------------
for (const p of policies) {
  let s = `CREATE POLICY ${p.qname} ON ${p.qtable}`;
  if (p.permissive === "RESTRICTIVE") s += " AS RESTRICTIVE";
  if (p.cmd !== "ALL") s += ` FOR ${p.cmd}`;
  s += ` TO ${p.roles}`;
  if (p.qual !== null) s += `\n    USING (${p.qual})`;
  if (p.with_check !== null) s += `\n    WITH CHECK (${p.with_check})`;
  if (s.includes("$$")) die(`Politica ${p.name}: tiene $$ en su texto.`);
  const sql = `DO $$ BEGIN\n  ${s};\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  const d = new Set(catalogDeps("pg_policy", p.oid));
  if (tableByOid.has(p.rel)) d.add(tid(p.rel));
  const node = { id: `policy:${p.oid}`, kind: "policy", name: `${p.schema}.${p.tbl}.${p.name}`, sql, deps: d };
  if (p.schema === "storage") node.area = bucketArea;
  addNode(node);
}

// --- Realtime -------------------------------------------------------------------
for (const r of realtime) {
  const t = tables.find((t) => t.schema === r.schema && t.name === r.tbl);
  addNode({
    id: `realtime:${t.oid}`,
    kind: "realtime",
    name: `${r.schema}.${r.tbl}`,
    sql: `DO $$ BEGIN\n  ALTER PUBLICATION supabase_realtime ADD TABLE ${t.qname};\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    deps: new Set([tid(t.oid)]),
  });
}

// --- Filas iniciales ------------------------------------------------------------
for (const [t, { cols, rows }] of Object.entries(seedRows)) {
  const table = tables.find((x) => `${x.schema}.${x.name}` === t);
  const cfg = SEEDS[t];
  for (const row of rows) {
    const names = [];
    const values = [];
    for (const c of cols) {
      if (c.name in cfg.now) {
        if (cfg.now[c.name] === null) continue; // la deja el default de la columna
        names.push(c.qname);
        values.push(cfg.now[c.name]);
      } else {
        names.push(c.qname);
        const v = row[c.name];
        values.push(v === null ? "NULL" : typeof v === "object" ? lit(JSON.stringify(v)) : lit(v));
      }
    }
    addNode({
      id: `seed:${t}:${row[cols[0].name]}`,
      kind: "seed",
      name: `${t} ${row[cols[0].name]}`,
      sql: `INSERT INTO ${table.qname} (${names.join(", ")})\nVALUES (${values.join(", ")})\nON CONFLICT (${cfg.conflict}) DO NOTHING;`,
      deps: new Set([tid(table.oid)]),
    });
  }
}

// --- Cron y buckets -------------------------------------------------------------
for (const j of cronJobs) {
  let sql = `SELECT cron.schedule(${lit(j.jobname)}, ${lit(j.schedule)}, ${lit(j.command)});`;
  if (!j.active) sql += `\nSELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = ${lit(j.jobname)}), active := false);`;
  const d = new Set();
  for (const m of j.command.toLowerCase().matchAll(/\b(public|private)\.([a-z_][a-z0-9_]*)\s*\(/g)) {
    for (const g of fnNames.get(`${m[1]}.${m[2]}`) ?? []) d.add(fid(g.oid));
  }
  addNode({ id: `cron:${j.jobname}`, kind: "cron", area: cronArea, name: j.jobname, sql, deps: d });
}
for (const b of buckets) {
  if (b.owner || b.avif_autodetection) die(`Bucket ${b.id}: owner o avif_autodetection no soportados.`);
  if (b.name !== b.id) die(`Bucket ${b.id}: su nombre es distinto del id.`);
  const mimes = b.allowed_mime_types ? `ARRAY[${b.allowed_mime_types.map(lit).join(", ")}]` : "NULL";
  addNode({
    id: `bucket:${b.id}`,
    kind: "bucket",
    area: bucketArea,
    name: b.id,
    sql:
      `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)\n` +
      `VALUES (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? "NULL"}, ${mimes})\n` +
      `ON CONFLICT (id) DO NOTHING;`,
  });
}

// --- Extensiones y esquema private ---------------------------------------------
{
  const have = new Map(extensions.map((e) => [e.name, e.schema]));
  const lines = [];
  for (const e of EXTENSIONS) {
    if (!have.has(e.name)) die(`La extension ${e.name} no esta en la base de referencia.`);
    lines.push(`CREATE EXTENSION IF NOT EXISTS ${e.name}${e.schema ? ` WITH SCHEMA ${e.schema}` : ""};`);
  }
  addNode({ id: "ext", kind: "ext", area: extArea, name: "extensiones", sql: lines.join("\n") });
  const s = schemaInfo[0];
  if (!s) die("No existe el esquema private.");
  if (s.owner !== "postgres" || s.grants) die(`El esquema private tiene permisos no soportados (${s.grants}).`);
  const parts = ["CREATE SCHEMA IF NOT EXISTS private;"];
  if (s.comment) parts.push(commentSql("SCHEMA", "private", s.comment));
  addNode({ id: "schema:private", kind: "schema", area: extArea, name: "private", sql: parts.join("\n") });
}
// Todo lo que vive en private depende del esquema.
for (const n of nodes.values()) {
  if (n.kind === "ext" || n.kind === "schema") continue;
  if (/^private\./.test(n.name)) n.deps.add("schema:private");
  n.deps.add("ext");
}

// ---------------------------------------------------------------------------
// Area de los objetos que van "con su tabla": la mas tardia de lo que usan.
// ---------------------------------------------------------------------------
const pending = [...nodes.values()].filter((n) => n.area === undefined);
let changed = true;
while (changed) {
  changed = false;
  for (const n of pending) {
    if (n.area !== undefined) continue;
    const areas = [...n.deps].map((d) => nodes.get(d)?.area);
    if (areas.every((a) => a !== undefined)) {
      n.area = Math.max(...areas);
      if (OVERRIDES[n.name] !== undefined) n.area = AREAS.findIndex((a) => a.file === OVERRIDES[n.name]);
      changed = true;
    }
  }
}
const lost = pending.filter((n) => n.area === undefined);
if (lost.length) die("Objetos sin area: " + lost.map((n) => `${n.kind} ${n.name}`).join(", "));

// Ninguna dependencia hacia un area posterior.
const violations = [];
for (const n of nodes.values()) {
  for (const d of n.deps) {
    const dn = nodes.get(d);
    if (!dn) continue;
    if (dn.area > n.area) violations.push(`${AREAS[n.area].file}: ${n.kind} ${n.name} usa ${dn.kind} ${dn.name} (${AREAS[dn.area].file})`);
  }
}
if (violations.length) die(`Dependencias hacia un area posterior (moverlas en areas.mjs):\n  ${violations.join("\n  ")}`);

// ---------------------------------------------------------------------------
// Orden dentro de cada area: topologico, y a igualdad, por tipo y nombre.
// ---------------------------------------------------------------------------
const files = AREAS.map(() => []);
const done = new Set();
for (let a = 0; a < AREAS.length; a++) {
  const inArea = [...nodes.values()].filter((n) => n.area === a);
  const left = new Set(inArea.map((n) => n.id));
  while (left.size) {
    const ready = inArea
      .filter((n) => left.has(n.id) && [...n.deps].every((d) => done.has(d) || !nodes.has(d)))
      .sort((x, y) => KIND_RANK[x.kind] - KIND_RANK[y.kind] || x.name.localeCompare(y.name));
    if (!ready.length) {
      const stuck = inArea.filter((n) => left.has(n.id));
      die(`Ciclo en ${AREAS[a].file}: ${stuck.map((n) => `${n.kind} ${n.name} -> [${[...n.deps].filter((d) => left.has(d)).map((d) => nodes.get(d).name).join(", ")}]`).join("; ")}`);
    }
    const n = ready[0];
    files[a].push(n);
    done.add(n.id);
    left.delete(n.id);
  }
}

// Resumen por area.
console.log("Areas:");
for (let a = 0; a < AREAS.length; a++) {
  const count = {};
  for (const n of files[a]) count[n.kind] = (count[n.kind] ?? 0) + 1;
  console.log(`  ${AREAS[a].file}: ${Object.entries(count).map(([k, v]) => `${v} ${k}`).join(", ") || "(permisos por defecto)"}`);
}
console.log(`Claves foraneas declaradas aparte (hacia un area posterior o en un ciclo): ${separateFk.size}`);
for (const c of constraints.filter((c) => separateFk.has(c.oid))) {
  const n = nodes.get(`fk:${c.oid}`);
  console.log(`  ${tableByOid.get(c.rel).name}.${c.name} -> ${tableByOid.get(c.ref).name} (en ${AREAS[n.area].file})`);
}
if (checkOnly) process.exit(0);

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------
const SECTION = { ext: "Extensiones", schema: "Esquemas", table: "Tablas", fk: "Claves foraneas hacia tablas de esta area", function: "Funciones", index: "Indices", trigger: "Disparadores", policy: "Reglas de acceso (RLS)", realtime: "Tiempo real", seed: "Datos iniciales", bucket: "Carpetas de archivos", cron: "Cron (pg_cron)" };
const migrationsDir = join(outDir, "migrations");
rmSync(migrationsDir, { recursive: true, force: true });
mkdirSync(migrationsDir, { recursive: true });

function header(area) {
  const bar = "-- " + "=".repeat(76);
  const body = area.header.split("\n").map((l) => (l ? `-- ${l}` : "--"));
  return [bar, `-- ${area.title}`, "--", ...body, bar, ""].join("\n");
}

for (let a = 0; a < AREAS.length; a++) {
  const area = AREAS[a];
  const out = [header(area)];
  if (area.special === "default_privileges") {
    out.push(DEFAULT_PRIVILEGES_SQL);
  }
  let lastKind = null;
  for (const n of files[a]) {
    if (n.kind !== lastKind) {
      out.push(`-- ${"-".repeat(76)}\n-- ${SECTION[n.kind]}\n-- ${"-".repeat(76)}\n`);
      lastKind = n.kind;
    }
    out.push(n.sql + "\n");
  }
  writeFileSync(join(migrationsDir, `${area.file}.sql`), out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n");
}

// Seeds y config.
const seedsDir = join(outDir, "seeds");
rmSync(seedsDir, { recursive: true, force: true });
mkdirSync(seedsDir, { recursive: true });
for (const f of readdirSync(join(repo, "supabase", "seeds")).filter((f) => f.endsWith(".sql")).sort()) {
  const src = readFileSync(join(repo, "supabase", "seeds", f), "utf8");
  writeFileSync(join(seedsDir, f), cleanSeed(f, src));
}
const config = readFileSync(join(repo, "supabase", "config.toml"), "utf8");
const SEED_CONFIG = `\n# Los seeds (precios de los modelos de IA) no se cargan solos: se corren a mano despues de crear\n# el primer usuario (ver el README). Sin esto, \`supabase db reset\` avisa que falta supabase/seed.sql.\n[db.seed]\nenabled = false\n`;
writeFileSync(join(outDir, "config.toml"), `project_id = "plantilla-estudiantes"\n\n` + config.replace(/^project_id\s*=.*\n/m, "") + SEED_CONFIG);
console.log(`\nEscrito en ${outDir}`);

// Los seeds: ver SEED_REWRITES (arriba).
function cleanSeed(file, src) {
  let s = src;
  for (const [from, to] of SEED_REWRITES[file] ?? []) {
    if (!s.includes(from)) die(`seeds/${file}: no se encontro el texto a reescribir "${from.slice(0, 60)}..."`);
    s = s.split(from).join(to);
  }
  return lexSql(s)
    .map((t) => (t.type === "line_comment" ? "--" + cleanComment(t.text.slice(2)) : t.text))
    .join("");
}

