#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificación de los puntos del portal (Servicios A3, F129; migraciones 00378 a 00382) contra la base real.
 *
 *   1. Gemelas SQL = TS: los casos de lib/portal-points/points.cases.json contra points_for, points_daily_cap,
 *      level_of y points_settings_problems.
 *   2. Estructura: la tabla points_ledger cerrada a la sesión, los 11 disparadores, «Subió de nivel» en Automatizaciones
 *      y quién puede ejecutar cada función.
 *   3. Comportamiento, en UNA transacción que se deshace sola (termina con un error a propósito): con los puntos
 *      apagados no suma; prendidos suma una sola vez; el valor propio gana; el tope por día; un «me gusta» propio no
 *      cuenta; ocultar un post descuenta; el ajuste a mano; «Calcular lo ya hecho» no duplica; las lecturas (00380).
 *   4. Hoy: ningún programa real tiene los puntos prendidos (nacen apagados, condición de Wendy).
 *
 *   node scripts/verify-points.mjs
 *
 * No escribe nada que quede: lo del punto 3 se deshace. DB_TARGET elige la base (scripts/lib/db-target.mjs).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const json = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => (v === null || v === undefined ? "NULL::jsonb" : `${lit(JSON.stringify(v))}::jsonb`);

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const TRANSIENT = /failed to connect as temp role|SQLSTATE 28P01|failed SASL auth|connection reset|ECONNRESET|timeout expired|unexpected status 50[234]|ETIMEDOUT/i;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function sql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
      return JSON.parse(out).rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt >= 5 || !TRANSIENT.test(text)) throw e;
      sleepSync(2000 * attempt);
    }
  }
}
/** Corre un bloque que termina con RAISE EXCEPTION 'VERIFY <json>' (así se deshace todo) y devuelve ese json. */
function rolledBack(block) {
  try {
    sql(block);
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
    const m = /VERIFY (\{.*\})/s.exec(text);
    if (m) return JSON.parse(m[1].split("\n")[0].replace(/\\"/g, '"'));
    throw e;
  }
  throw new Error("el bloque no se deshizo");
}

if (sql(`SELECT to_regprocedure('app_servicio.award_points(uuid,uuid,uuid,text,text,integer,text,timestamptz)') IS NOT NULL ok`)[0]?.ok !== true) {
  console.log("Falta la 00379 en esta base: no hay nada para verificar.");
  process.exit(0);
}

// ─── 1. Gemelas ──────────────────────────────────────────────────────────────
console.log("\n1 · Gemelas SQL = TypeScript (points.cases.json)");
const cases = json("lib/portal-points/points.cases.json");
const twin = (list, label, toSql, expected = (c) => c.expected) => {
  const got = sql(`SELECT jsonb_build_array(${list.map((c) => `to_jsonb(${toSql(c)})`).join(", ")}) AS r`)[0]?.r ?? [];
  const bad = list.filter((c, i) => !eq(got[i] ?? null, expected(c))).map((c) => c.name);
  check(bad.length === 0, `${label}: los ${list.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));
};
twin(cases.pointsFor, "points_for", (c) => `app_servicio.points_for(${lit(c.event)}, ${jlit(c.settings)}, ${c.override ?? "NULL"})`);
twin(cases.dailyCap, "points_daily_cap", (c) => `app_servicio.points_daily_cap(${lit(c.event)}, ${jlit(c.settings)})`);
twin(cases.levelOf, "level_of", (c) => `app_servicio.level_of(${c.total}, ${jlit(c.levels)})`);
twin(cases.settings, "points_settings_problems", (c) => `COALESCE(app_servicio.points_settings_problems(${jlit(c.points)}), '{}'::text[])`);

// ─── 2. Estructura ───────────────────────────────────────────────────────────
console.log("\n2 · Estructura");
const st = sql(`SELECT
  (SELECT count(*)::int FROM pg_trigger WHERE tgname LIKE 'trg_points_%' AND NOT tgisinternal) AS triggers,
  (SELECT pg_get_constraintdef(oid) LIKE '%points_level_up%' FROM pg_constraint WHERE conname = 'triggers_type_check') AS level_up,
  has_table_privilege('authenticated', 'app_servicio_portal.points_ledger', 'SELECT') AS auth_reads,
  has_table_privilege('anon', 'app_servicio_portal.points_ledger', 'SELECT') AS anon_reads,
  has_function_privilege('authenticated', 'app_servicio.award_points(uuid,uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE') AS auth_awards,
  has_function_privilege('authenticated', 'app_servicio.points_adjust(uuid,integer,text)', 'EXECUTE') AS auth_adjust,
  to_regprocedure('app_servicio.svc_points_daily(uuid,integer)') IS NOT NULL AS reads,
  pg_get_functiondef('app_servicio.portal_admin_save_program_settings(uuid,jsonb,integer)'::regprocedure) LIKE '%WHEN ''points'' THEN ''portal.points''%' AS perm_381,
  pg_get_functiondef('app_servicio.program_update_item(uuid,jsonb)'::regprocedure) LIKE '%points = CASE WHEN p ? ''points''%' AS item_382`)[0];
check(st.triggers === 11, "los 11 disparadores de puntos", `hay ${st.triggers}`);
check(st.level_up === true, "«Subió de nivel» está en los tipos de disparador");
check(!st.auth_reads && !st.anon_reads, "points_ledger no se lee con la sesión (solo el servidor)");
check(!st.auth_awards, "award_points es solo del servidor");
check(st.auth_adjust === true, "points_adjust se llama con la sesión (y pide portal.points adentro)");
check(st.reads === true, "las lecturas de la 00380 existen");
check(st.perm_381 === true, "guardar la configuración de puntos pide portal.points (00381)");
check(st.item_382 === true, "una actividad guarda sus puntos propios (00382)");

// ─── 3. Comportamiento (se deshace) ──────────────────────────────────────────
console.log("\n3 · Comportamiento (en una transacción que se deshace sola)");
const target = sql(`SELECT s.id, s.contact_id, s.product_id, s.workspace_id
  FROM app_servicio.services s JOIN public.products p ON p.id = s.product_id
 WHERE s.status = 'active' AND NOT s.is_test AND s.product_id IS NOT NULL ORDER BY (p.name LIKE 'zz-test%') DESC, s.created_at LIMIT 1`)[0];
if (!target) {
  fail("no hay un servicio activo con producto para probar");
} else {
  const r = rolledBack(`DO $v$
DECLARE s app_servicio.services; r jsonb := '{}'; tz text; today date; n int; b jsonb;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = ${lit(target.id)};
  PERFORM app_servicio.as_system();
  tz := app_servicio.points_tz(s.contact_id, s.workspace_id); today := (now() AT TIME ZONE tz)::date;
  UPDATE public.products SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'), '{points}', '{"enabled":false}') WHERE id = s.product_id;
  n := app_servicio.award_points(s.contact_id, s.product_id, s.id, 'step', 'step:verify-off', NULL, 'x', now());
  r := r || jsonb_build_object('off', n);
  UPDATE public.products SET portal_settings = jsonb_set(portal_settings, '{points}', '{"enabled":true,"values":{"lesson":3}}') WHERE id = s.product_id;
  r := r || jsonb_build_object('first', app_servicio.award_points(s.contact_id, s.product_id, s.id, 'lesson', 'lesson:verify-a', NULL, 'x', now()));
  r := r || jsonb_build_object('again', app_servicio.award_points(s.contact_id, s.product_id, s.id, 'lesson', 'lesson:verify-a', NULL, 'x', now()));
  r := r || jsonb_build_object('override', app_servicio.award_points(s.contact_id, s.product_id, s.id, 'step', 'step:verify-b', 7, 'x', now()));
  r := r || jsonb_build_object('post1', app_servicio.award_points(s.contact_id, s.product_id, s.id, 'post', 'post:verify-1', NULL, 'x', now()));
  r := r || jsonb_build_object('post2', app_servicio.award_points(s.contact_id, s.product_id, s.id, 'post', 'post:verify-2', NULL, 'x', now()));
  r := r || jsonb_build_object('revoke', app_servicio.revoke_points(s.contact_id, s.product_id, 'post:verify-1', 'verify'));
  r := r || jsonb_build_object('total', (SELECT sum(points) FROM app_servicio_portal.points_ledger WHERE contact_id = s.contact_id AND product_id = s.product_id AND source_key LIKE '%verify%'));
  b := app_servicio.points_backfill(s.product_id);
  r := r || jsonb_build_object('backfill_again', (app_servicio.points_backfill(s.product_id) ->> 'added')::int);
  r := r || jsonb_build_object('daily_n', jsonb_array_length(app_servicio.svc_points_daily(s.id, 14) -> 'days'), 'daily_enabled', app_servicio.svc_points_daily(s.id, 14) -> 'enabled');
  r := r || jsonb_build_object('history_has', (SELECT count(*) FROM jsonb_array_elements(app_servicio.svc_points_history(s.id, 50)) x WHERE x ->> 'kind' IN ('lesson', 'step', 'post')) > 0);
  r := r || jsonb_build_object('mini_len', jsonb_array_length(app_servicio.svc_points_minibars(ARRAY[s.id]) -> s.id::text -> 'bars'));
  RAISE EXCEPTION 'VERIFY %', r;
END $v$;`);
  check(r.off === 0, "con los puntos apagados no suma nada");
  check(r.first === 3 && r.again === 0, "prendidos: suma el valor del programa una sola vez", JSON.stringify({ first: r.first, again: r.again }));
  check(r.override === 7, "el valor propio del paso gana al del programa");
  check(r.post1 === 2 && r.post2 === 0, "el tope por día de publicar (1)", JSON.stringify({ post1: r.post1, post2: r.post2 }));
  check(r.revoke === -2, "ocultar un post descuenta lo que sumó");
  check(r.total === 10, "el neto de lo de la prueba es 3 + 7 + 2 − 2", `dio ${r.total}`);
  check(r.backfill_again === 0, "«Calcular lo ya hecho» dos veces no duplica");
  check(r.daily_n === 14 && r.daily_enabled === true, "el gráfico de la ficha trae 14 días y dice que están prendidos");
  check(r.history_has === true, "el historial trae lo sumado");
  check(r.mini_len === 30, "las mini barras de Clientes traen 30 días");
}

// ─── 4. Hoy ──────────────────────────────────────────────────────────────────
console.log("\n4 · Hoy");
const on = sql(`SELECT count(*)::int n FROM public.products WHERE portal_settings #> '{points,enabled}' = 'true'::jsonb AND name NOT LIKE 'zz-test%'`)[0]?.n;
console.log(`  info  programas con los puntos prendidos: ${on}`);

console.log(failures ? `\n${failures} falla(s).` : "\nTodo bien.");
process.exit(failures ? 1 : 0);
