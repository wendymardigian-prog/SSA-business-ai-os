#!/usr/bin/env node
/**
 * Cuanto le cuestan los cron a la base (docs/crons.md). Solo LEE: se puede
 * correr cuando sea, contra produccion.
 *
 * Muestra, para las ultimas 24 horas (o --horas=N):
 *   1. Corridas de cada cron de pg_cron y el tiempo total que tardaron
 *      (cron.job_run_details). Cada corrida abre una conexion a la base
 *      (cron.use_background_workers = off) y escribe tres veces en ese
 *      historial: por eso desde la 00350 los de la misma frecuencia son un
 *      solo trabajo (lib/cron/ticks.json).
 *   2. Llamadas a la app: por cada ruta, cuantas llamo y cuantas salteo la
 *      guarda (private.cron_guard_state, desde la 00327; antes de la 00327 cada
 *      corrida era una llamada), y en que trabajo de pg_cron corre.
 *   2b. Los errores de las partes de un trabajo agrupado
 *      (private.cron_tick_errors, desde la 00350): la corrida dice "succeeded"
 *      aunque una parte haya fallado.
 *   3. Pedidos HTTP que salieron de verdad (net._http_response, se guarda 1 dia).
 *   4. Si se puede leer pg_stat_statements: lo que lleva Realtime leyendo cambios.
 *
 *   node scripts/measure-cron-load.mjs [--horas=24]
 */
import { execFileSync } from "node:child_process";
import { dbTargetArgs } from "./lib/db-target.mjs";

const hours = Number(process.argv.find((a) => a.startsWith("--horas="))?.slice(8) ?? 24);
if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
  console.error("--horas tiene que ser un numero entre 1 y 72");
  process.exit(1);
}

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

function table(rows, columns) {
  const widths = columns.map(([key, label]) => Math.max(label.length, ...rows.map((r) => String(r[key] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log("  " + line(columns.map(([, label]) => label)));
  for (const r of rows) console.log("  " + line(columns.map(([key]) => r[key] ?? "")));
}

const window = `now() - interval '${hours} hours'`;

console.log(`\nCorridas de pg_cron en las ultimas ${hours} h`);
const runs = sql(`
  SELECT j.jobname, j.command, count(*) AS corridas,
         round(sum(extract(epoch FROM d.end_time - d.start_time))::numeric, 1) AS segundos,
         round(avg(extract(epoch FROM d.end_time - d.start_time))::numeric * 1000, 1) AS ms_promedio,
         count(*) FILTER (WHERE d.status <> 'succeeded') AS fallidas
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.start_time > ${window}
  GROUP BY 1, 2
  ORDER BY 3 DESC`);
table(runs, [["jobname", "cron"], ["corridas", "corridas"], ["segundos", "segundos"], ["ms_promedio", "ms prom."], ["fallidas", "fallidas"]]);
const totalRuns = runs.reduce((a, r) => a + Number(r.corridas), 0);
const totalSecs = runs.reduce((a, r) => a + Number(r.segundos), 0);
const bgWorkers = sql(`SELECT current_setting('cron.use_background_workers', true) AS v`)[0]?.v;
console.log(`  TOTAL: ${totalRuns} corridas, ${totalSecs.toFixed(1)} s`);
console.log(
  bgWorkers === "on"
    ? `  (cron.use_background_workers = on: las corridas no abren conexion; escriben ${totalRuns * 3} veces en cron.job_run_details)`
    : `  (cron.use_background_workers = ${bgWorkers ?? "?"}: ${totalRuns} conexiones a la base y ${totalRuns * 3} escrituras en cron.job_run_details)`,
);

console.log("\nLlamadas a la app (private.call_app_cron)");
const hasGuard = sql(`SELECT to_regclass('private.cron_guard_state') IS NOT NULL AS ok`)[0]?.ok === true;
// En que trabajo corre cada ruta: el suyo (comando con la ruta) o uno agrupado (la ruta esta en el cuerpo de su funcion).
const jobOf = new Map();
for (const j of sql(`
  SELECT j.jobname, j.command, CASE WHEN f.oid IS NOT NULL THEN pg_get_functiondef(f.oid) END AS body
  FROM cron.job j
  LEFT JOIN pg_proc f ON f.oid = to_regprocedure(substring(j.command FROM 'SELECT (private\\.cron_tick_[a-z0-9_]+)\\(\\)') || '()')`)) {
  const text = `${j.command}\n${j.body ?? ""}`;
  for (const m of text.matchAll(/call_app_cron(_if_work)?\('([^']+)'/g)) jobOf.set(m[2], { job: j.jobname, viaGuard: Boolean(m[1]) });
}
const runsByJob = new Map(runs.map((r) => [r.jobname, r.corridas]));
const guarded = hasGuard
  ? new Map(sql(`SELECT path, called_count, skipped_count, counted_since FROM private.cron_guard_state`).map((r) => [r.path, r]))
  : new Map();
const rows = [...jobOf.entries()].map(([path, { job, viaGuard }]) => {
  const g = guarded.get(path);
  return {
    path,
    job: job === path ? "(el suyo)" : job,
    corridas: runsByJob.get(job) ?? 0,
    llamadas: viaGuard ? (g ? `${g.called_count} desde ${String(g.counted_since).slice(0, 16)}` : "sin datos todavia") : runsByJob.get(job) ?? 0,
    salteadas: viaGuard ? (g ? g.skipped_count : "-") : "sin guarda",
  };
});
rows.sort((a, b) => Number(b.corridas) - Number(a.corridas) || a.path.localeCompare(b.path));
table(rows, [["path", "ruta"], ["job", "trabajo de pg_cron"], ["corridas", "corridas"], ["llamadas", "llamadas a la app"], ["salteadas", "salteadas por la guarda"]]);
if (!hasGuard) console.log("  (la 00327 no esta aplicada: cada corrida es una llamada)");
else console.log("  (los contadores de la guarda son desde 'counted_since', no de la ventana; se vacian si la base se reinicia)");

console.log("\nErrores de las partes de los trabajos agrupados (private.cron_tick_errors)");
if (sql(`SELECT to_regclass('private.cron_tick_errors') IS NOT NULL AS ok`)[0]?.ok !== true) {
  console.log("  (la 00350 no esta aplicada)");
} else {
  const errors = sql(`SELECT part, error_count, last_error_at::text AS ultimo, left(last_error, 80) AS error FROM private.cron_tick_errors ORDER BY last_error_at DESC`);
  if (errors.length === 0) console.log("  ninguno");
  else table(errors, [["part", "parte"], ["error_count", "veces"], ["ultimo", "ultimo"], ["error", "error"]]);
}

console.log("\nPedidos HTTP que salieron (net._http_response, se guarda 1 dia)");
const http = sql(`SELECT count(*) AS pedidos, min(created)::text AS desde FROM net._http_response WHERE created > ${window}`)[0];
console.log(`  ${http?.pedidos ?? 0} pedidos desde ${http?.desde ?? "-"}`);

console.log("\nRealtime leyendo cambios (pg_stat_statements, desde el ultimo reinicio de estadisticas)");
try {
  const rt = sql(`
    SELECT calls, round(total_exec_time::numeric / 1000, 1) AS segundos, round(mean_exec_time::numeric, 2) AS ms_promedio
    FROM extensions.pg_stat_statements
    WHERE query ILIKE '%list_changes%'
    ORDER BY total_exec_time DESC LIMIT 3`);
  if (rt.length === 0) console.log("  sin datos");
  table(rt, [["calls", "llamadas"], ["segundos", "segundos"], ["ms_promedio", "ms prom."]]);
} catch {
  console.log("  no se pudo leer pg_stat_statements");
}
console.log("");
