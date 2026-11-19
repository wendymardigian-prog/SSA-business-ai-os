#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificación de la 00460 y la 00461 (disparadores traídos de RER): correr DESPUÉS de aplicarlas.
 *
 * Solo LEE la base (no escribe nada, no hace falta el candado de los otros verify-*):
 *   1. Las reglas puras de la base dan lo mismo que las de TypeScript:
 *      `svc_relative_hours_due` con lib/services/relative-hours.cases.json y
 *      `svc_metric_crossed` con lib/services/metric-crossed.cases.json.
 *   2. El CHECK de triggers.type acepta todos los tipos del catálogo (incluido `service_metric_reached`).
 *   3. `app_servicio.trigger_anchor_fires` existe, con RLS y sin acceso para las sesiones.
 *   4. El cron horario `svc-daily` llama al barrido en horas, y están los triggers de puntos, pagos y proyectos.
 *   5. Ninguna función nueva la puede ejecutar una sesión (anon/authenticated).
 *
 *   node scripts/verify-disparadores-relativos.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const hoursCases = JSON.parse(readFileSync(repoFile("lib/services/relative-hours.cases.json"), "utf8")).cases;
const metricCases = JSON.parse(readFileSync(repoFile("lib/services/metric-crossed.cases.json"), "utf8")).cases;
const catalog = [...readFileSync(repoFile("lib/flow-engine/trigger-catalog.ts"), "utf8").matchAll(/\{ type: "([a-z_]+)"/g)].map((m) => m[1]);

try {
  console.log("\n1. Las reglas: SQL = TypeScript");
  {
    const values = hoursCases.map((c, i) => `(${i}, ${lit(c.anchor_at)}::timestamptz, ${c.offset_hours}, ${lit(c.now)}::timestamptz)`).join(", ");
    const rows = sql(`SELECT i, app_servicio.svc_relative_hours_due(a, o, n) AS due FROM (VALUES ${values}) v(i, a, o, n) ORDER BY i`);
    hoursCases.forEach((c, i) => check(rows[i]?.due === c.due, `horas: ${c.name}`, `base ${rows[i]?.due}, TS ${c.due}`));
    const mv = metricCases.map((c, i) => `(${i}, ${c.before}::numeric, ${c.after}::numeric, ${c.threshold}::numeric)`).join(", ");
    const mr = sql(`SELECT i, app_servicio.svc_metric_crossed(b, a, t) AS crossed FROM (VALUES ${mv}) v(i, b, a, t) ORDER BY i`);
    metricCases.forEach((c, i) => check(mr[i]?.crossed === c.crossed, `cifra: ${c.name}`, `base ${mr[i]?.crossed}, TS ${c.crossed}`));
  }

  console.log("\n2. El CHECK de triggers.type");
  {
    const [row] = sql(`SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'public.triggers'::regclass AND c.conname = 'triggers_type_check'`);
    const accepted = new Set([...String(row?.def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    const missing = catalog.filter((t) => !accepted.has(t));
    check(missing.length === 0, `acepta los ${catalog.length} tipos del catálogo`, `faltan: ${missing.join(", ")}`);
  }

  console.log("\n3. Un envío por automatización");
  {
    const [t] = sql(`SELECT c.relrowsecurity AS rls,
        has_table_privilege('authenticated', 'app_servicio.trigger_anchor_fires', 'SELECT') AS auth_select,
        has_table_privilege('anon', 'app_servicio.trigger_anchor_fires', 'SELECT') AS anon_select
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app_servicio' AND c.relname = 'trigger_anchor_fires'`);
    check(!!t, "existe app_servicio.trigger_anchor_fires");
    check(t?.rls === true, "con RLS prendida");
    check(t?.auth_select === false && t?.anon_select === false, "sin acceso para las sesiones");
  }

  console.log("\n4. Quién los emite");
  {
    const [f] = sql(`SELECT pg_get_functiondef('private.enqueue_svc_daily(timestamptz)'::regprocedure) AS def`);
    check(String(f?.def ?? "").includes("svc_relative_hours_tick"), "el cron horario svc-daily corre los de horas");
    const triggers = sql(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('points_ledger_metric_reached',
      'student_revenue_metric_ins', 'student_revenue_metric_upd', 'student_revenue_metric_del', 'student_projects_metric_ins', 'student_projects_metric_upd')`).map((r) => r.tgname);
    check(triggers.includes("points_ledger_metric_reached"), "trigger de puntos");
    check(triggers.filter((t) => t.startsWith("student_")).length === 5, "triggers de pagos y proyectos (00461)", `hay: ${triggers.join(", ")}`);
  }

  console.log("\n5. Nadie con sesión ejecuta las funciones nuevas");
  {
    const rows = sql(`SELECT p.oid::regprocedure::text AS fn, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE (n.nspname = 'app_servicio' AND p.proname IN ('svc_relative_hours_due', 'svc_relative_hours_tick', 'svc_metric_crossed', 'svc_metric_fire', 'svc_metric_on_points'))
         OR (n.nspname = 'app_servicio_proyectos' AND p.proname LIKE 'metric\\_%')`);
    check(rows.length >= 10, `están las ${rows.length} funciones`);
    for (const r of rows) check(!r.auth && !r.anon, `${r.fn} cerrada`);
  }
} catch (error) {
  fail("el verify se cortó", error instanceof Error ? error.message : String(error));
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s).`);
process.exit(failures === 0 ? 0 : 1);
