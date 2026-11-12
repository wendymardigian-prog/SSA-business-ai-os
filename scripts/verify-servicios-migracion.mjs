#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificacion al aplicar cada migracion de Servicios (Corrida A1, requerimientos §2).
 *
 * Revisa el catalogo de la base (solo lee) para la migracion pedida:
 *   - que existan sus objetos (tablas, columnas, funciones, triggers, politicas, CHECK);
 *   - RLS prendida en cada tabla nueva; app_servicio sin politicas de escritura;
 *     app_servicio_portal sin USAGE para anon ni authenticated;
 *   - ninguna funcion de los esquemas del modulo ejecutable por anon o public, y todas
 *     con search_path fijo;
 *   - que los CHECK ampliados sigan aceptando los valores viejos (los del punto de partida);
 *   - que cada funcion de trigger del modulo salga sin hacer nada con el modulo apagado
 *     (mira que llame a app_servicio.module_on antes de tocar nada);
 *   - las huellas de las funciones protegidas y de las que no se tocan.
 *
 *   node scripts/verify-servicios-migracion.mjs --s S01        una migracion
 *   node scripts/verify-servicios-migracion.mjs --s S01,S02    varias
 *   node scripts/verify-servicios-migracion.mjs --todas        las que ya estan aplicadas
 *   node scripts/verify-servicios-migracion.mjs --a4 M1        una migracion de la Corrida A4 (M1 a M9, §20.3)
 *
 * No escribe nada: no necesita el candado (igual se puede correr con el).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";
import { SPECS, OLD_CHECK_VALUES, MODULE_ON_EXEMPT, A4_SPECS, RAISES_ON_PURPOSE } from "./verify-servicios-migracion.spec.mjs";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).rows ?? [];
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

function parseArgs(argv) {
  const i = argv.indexOf("--s");
  const a4 = argv.indexOf("--a4");
  if (a4 >= 0 && argv[a4 + 1]) return { all: false, ids: argv[a4 + 1].split(",").map((s) => `A4${s.trim().toUpperCase()}`) };
  if (argv.includes("--todas")) return { all: true, ids: [] };
  if (i >= 0 && argv[i + 1]) return { all: false, ids: argv[i + 1].split(",").map((s) => s.trim().toUpperCase()) };
  console.error("Uso: --s S01[,S02] o --todas");
  process.exit(2);
}

function splitName(full) {
  const [a, b] = full.includes(".") ? full.split(".") : ["public", full];
  return { schema: a, name: b };
}

function verifySpec(id, spec) {
  console.log(`\n${id} · ${spec.title}`);

  for (const t of spec.tables ?? []) {
    const { schema, name } = splitName(t);
    const rows = sql(
      `SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${lit(schema)} AND c.relname = ${lit(name)} AND c.relkind IN ('r','p')`,
    );
    check(rows.length === 1, `existe la tabla ${t}`);
    if (rows.length === 1) check(rows[0].rls === true, `${t} tiene RLS prendida`);
    if (schema === "app_servicio") {
      const writes = sql(
        `SELECT policyname FROM pg_policies WHERE schemaname = ${lit(schema)} AND tablename = ${lit(name)}
         AND cmd IN ('INSERT','UPDATE','DELETE','ALL')`,
      );
      check(writes.length === 0, `${t} no tiene politicas de escritura`, writes.map((w) => w.policyname).join(", "));
    }
    if (schema === "app_servicio_portal") {
      const pols = sql(`SELECT policyname FROM pg_policies WHERE schemaname = ${lit(schema)} AND tablename = ${lit(name)}`);
      check(pols.length === 0, `${t} no tiene politicas (cerrada)`, pols.map((w) => w.policyname).join(", "));
    }
  }

  for (const c of spec.columns ?? []) {
    const [table, column] = c.split(":");
    const { schema, name } = splitName(table);
    const rows = sql(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = ${lit(schema)} AND table_name = ${lit(name)} AND column_name = ${lit(column)}`,
    );
    check(rows.length === 1, `existe la columna ${table}.${column}`);
  }

  for (const f of spec.functions ?? []) {
    const { schema, name } = splitName(f);
    const rows = sql(
      `SELECT p.oid::regprocedure::text AS sig, p.prosecdef AS definer,
              coalesce(array_to_string(p.proconfig, ','), '') AS config,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ${lit(schema)} AND p.proname = ${lit(name)}`,
    );
    check(rows.length >= 1, `existe la funcion ${f}`);
    for (const r of rows) {
      check(r.config.includes("search_path="), `${r.sig} tiene search_path fijo`, r.config);
      check(r.anon_exec === false && r.public_exec === false, `${r.sig} no la ejecuta anon ni public`);
    }
  }

  for (const tr of spec.triggers ?? []) {
    const [table, trigger] = tr.split(":");
    const { schema, name } = splitName(table);
    const rows = sql(
      `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${lit(schema)} AND c.relname = ${lit(name)} AND t.tgname = ${lit(trigger)} AND NOT t.tgisinternal`,
    );
    check(rows.length === 1, `existe el trigger ${trigger} en ${table}`);
  }

  for (const p of spec.policies ?? []) {
    const [table, policy] = p.split(":");
    const { schema, name } = splitName(table);
    const rows = sql(`SELECT 1 FROM pg_policies WHERE schemaname = ${lit(schema)} AND tablename = ${lit(name)} AND policyname = ${lit(policy)}`);
    check(rows.length === 1, `existe la politica ${policy} en ${table}`);
  }

  for (const b of spec.buckets ?? []) {
    const rows = sql(`SELECT public FROM storage.buckets WHERE id = ${lit(b)}`);
    check(rows.length === 1, `existe el bucket ${b}`);
    if (rows.length === 1) check(rows[0].public === false, `el bucket ${b} es privado`);
  }

  for (const ck of spec.checks ?? []) {
    const rows = sql(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${lit(ck.name)}`);
    check(rows.length === 1, `existe el CHECK ${ck.name}`);
    if (rows.length !== 1) continue;
    const def = rows[0].def;
    for (const v of [...(OLD_CHECK_VALUES[ck.name] ?? []), ...(ck.adds ?? [])]) {
      if (!def.includes(`'${v}'`)) fail(`${ck.name} acepta '${v}'`);
    }
    ok(`${ck.name} acepta los valores viejos y los nuevos (${(ck.adds ?? []).length} nuevos)`);
  }

  for (const s of spec.schemas ?? []) {
    const rows = sql(
      `SELECT has_schema_privilege('anon', ${lit(s.name)}, 'USAGE') AS anon_usage,
              has_schema_privilege('authenticated', ${lit(s.name)}, 'USAGE') AS auth_usage,
              has_schema_privilege('service_role', ${lit(s.name)}, 'USAGE') AS service_usage`,
    );
    check(rows.length === 1, `existe el esquema ${s.name}`);
    if (rows.length !== 1) continue;
    check(rows[0].anon_usage === false, `${s.name}: anon no tiene USAGE`);
    check(rows[0].auth_usage === s.authenticatedUsage, `${s.name}: authenticated ${s.authenticatedUsage ? "tiene" : "no tiene"} USAGE`);
    check(rows[0].service_usage === true, `${s.name}: service_role tiene USAGE`);
  }

  for (const f of spec.sqlChecks ?? []) {
    const rows = sql(f.query);
    check(rows.length > 0 && rows[0].ok === true, f.label, rows.length ? JSON.stringify(rows[0]) : "sin filas");
  }
}

function verifyGlobal() {
  console.log("\nReglas de toda la corrida");
  const existing = sql(`SELECT nspname FROM pg_namespace WHERE nspname IN ('app_servicio','app_servicio_portal','app_servicio_proyectos')`).map((r) => r.nspname);
  if (existing.length) {
    const bad = sql(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY (ARRAY[${existing.map(lit).join(",")}])
         AND (has_function_privilege('anon', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))`,
    );
    check(bad.length === 0, "ninguna funcion del modulo la ejecuta anon o public", bad.map((b) => b.sig).join(", "));
    const noPath = sql(
      `SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = ANY (ARRAY[${existing.map(lit).join(",")}]) AND p.prolang <> (SELECT oid FROM pg_language WHERE lanname = 'internal')
         AND NOT coalesce(array_to_string(p.proconfig, ','), '') LIKE '%search_path=%'`,
    );
    check(noPath.length === 0, "toda funcion del modulo tiene search_path fijo", noPath.map((b) => b.sig).join(", "));
    const noRls = sql(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ANY (ARRAY[${existing.map(lit).join(",")}]) AND c.relkind IN ('r','p') AND NOT c.relrowsecurity`,
    );
    check(noRls.length === 0, "toda tabla del modulo tiene RLS", noRls.map((r) => r.t).join(", "));
  }

  // Cada trigger del modulo sobre tablas de BAIOS sale si el modulo esta apagado.
  const hooks = sql(
    `SELECT t.tgname, p.proname, pg_get_functiondef(p.oid) AS def FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_app_servicio_%'`,
  );
  const seen = new Set();
  for (const h of hooks) {
    if (MODULE_ON_EXEMPT.includes(h.tgname) || seen.has(h.tgname + h.proname)) continue;
    seen.add(h.tgname + h.proname);
    check(/app_servicio\.module_on\s*\(/.test(h.def), `${h.tgname} sale sin hacer nada con el modulo apagado (llama a app_servicio.module_on)`);
    if (!RAISES_ON_PURPOSE.includes(h.tgname)) {
      check(/EXCEPTION\s+WHEN\s+OTHERS/i.test(h.def), `${h.tgname} no hace fallar lo que lo dispara (EXCEPTION WHEN OTHERS)`);
    }
    // Un tipo de tabla del modulo en el DECLARE se resuelve al entrar, ANTES del bloque que atrapa los errores:
    // un problema con esa tabla haria fallar la operacion de BAIOS. Se declara `record` (lo atrapo verify-services sv2).
    const declare = (h.def.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i)?.[1] ?? "").replace(/--.*$/gm, "");
    check(!/\bapp_servicio\.\w+\s*(%ROWTYPE)?\s*;/i.test(declare), `${h.tgname} no declara variables con tipos de tablas del modulo`);
  }

  // Ninguna tabla nueva en public (las 14 de A1 viven en los esquemas del modulo).
  const baseline = JSON.parse(readFileSync(repoFile("docs/servicios/punto-de-partida.json"), "utf8"));
  const fp = { ...baseline.protegidas, ...baseline.no_se_tocan };
  const rows = sql(
    `SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE (n.nspname = 'public' AND p.proname IN ('get_public_form','can_see_contact','can_see_sale','can_see_task','handle_new_user','has_permission','permission_scope'))
        OR (n.nspname = 'private' AND p.proname IN ('call_app_cron','call_app_cron_if_work','scope_rank','owner_only_keys','ungrantable_keys'))`,
  );
  for (const r of rows) {
    const key = r.sig.startsWith("private.") ? r.sig : r.sig.replace(/^public\./, "");
    if (fp[key]) check(fp[key] === r.md5, `la huella de ${key} es la del punto de partida`, fp[key] === r.md5 ? undefined : `dio ${r.md5}`);
  }
  checkProtectedFunctions(sql, check);
}

const { all, ids } = parseArgs(process.argv.slice(2));
try {
  let targets = ids;
  if (all) {
    const applied = sql(`SELECT name FROM supabase_migrations.schema_migrations`).map((r) => r.name);
    targets = Object.keys(SPECS).filter((id) => applied.some((n) => n.startsWith(SPECS[id].file.replace(/\.sql$/, ""))));
  }
  const ALL_SPECS = { ...SPECS, ...Object.fromEntries(Object.entries(A4_SPECS).map(([k, v]) => [`A4${k}`, v])) };
  if (all) {
    const applied = sql(`SELECT name FROM supabase_migrations.schema_migrations`).map((r) => r.name);
    for (const [k, v] of Object.entries(A4_SPECS)) if (applied.some((n) => n.startsWith(v.file.replace(/\.sql$/, "")))) targets.push(`A4${k}`);
  }
  for (const id of targets) {
    if (!ALL_SPECS[id]) {
      fail(`no hay caso para ${id}`);
      continue;
    }
    verifySpec(id, ALL_SPECS[id]);
  }
  verifyGlobal();
} catch (e) {
  fail("error al consultar la base", e instanceof Error ? e.message.split("\n")[0] : String(e));
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
