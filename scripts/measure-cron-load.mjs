#!/usr/bin/env node
/**
 * Cuanto le cuestan los cron a la base (docs/crons.md). Solo LEE: se puede
 * correr cuando sea, contra produccion.
 *
 * Muestra, para las ultimas 24 horas (o --horas=N):
 *   1. Corridas de cada cron de pg_cron y el tiempo total que tardaron
 *      (cron.job_run_details).
 *   2. Llamadas a la app: por cada cron que usa private.call_app_cron, cuantas
 *      llamo y cuantas salteo la guarda (private.cron_guard_state, desde la
 *      00327; antes de la 00327 cada corrida era una llamada).
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
console.log(`  TOTAL: ${totalRuns} corridas, ${totalSecs.toFixed(1)} s`);

console.log("\nLlamadas a la app (private.call_app_cron)");
const hasGuard = sql(`SELECT to_regclass('private.cron_guard_state') IS NOT NULL AS ok`)[0]?.ok === true;
const appCrons = runs.filter((r) => /call_app_cron/.test(r.command));
const guarded = hasGuard
  ? new Map(sql(`SELECT path, called_count, skipped_count, counted_since FROM private.cron_guard_state`).map((r) => [r.path, r]))
  : new Map();
const rows = appCrons.map((r) => {
  const path = /call_app_cron(?:_if_work)?\('([^']+)'/.exec(r.command)?.[1] ?? r.jobname;
  const g = guarded.get(path);
  const viaGuard = /call_app_cron_if_work/.test(r.command);
  return {
    path,
    corridas: r.corridas,
    llamadas: viaGuard ? (g ? `${g.called_count} desde ${String(g.counted_since).slice(0, 16)}` : "sin datos todavia") : r.corridas,
    salteadas: viaGuard ? (g ? g.skipped_count : "-") : "sin guarda",
  };
});
table(rows, [["path", "ruta"], ["corridas", "corridas"], ["llamadas", "llamadas a la app"], ["salteadas", "salteadas por la guarda"]]);
if (!hasGuard) console.log("  (la 00327 no esta aplicada: cada corrida es una llamada)");
else console.log("  (los contadores de la guarda son desde 'counted_since', no de la ventana; se vacian si la base se reinicia)");

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
